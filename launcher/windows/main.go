package main

import (
	"archive/zip"
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	_ "embed"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

//go:embed payload.zip
var payload []byte

const appURL = "http://localhost:3000/"

func main() {
	if len(os.Args) == 2 && (os.Args[1] == "--help" || os.Args[1] == "-h") {
		fmt.Println("Clausebook launcher for Windows x64. Requires Docker Desktop in Linux container mode.")
		fmt.Println("Run the launcher to start Clausebook with MongoDB Atlas. It reuses a .env file beside the executable.")
		return
	}
	if runtime.GOOS != "windows" {
		fmt.Fprintln(os.Stderr, "Build this launcher for Windows. Linux users can run start-clausebook.sh.")
		os.Exit(1)
	}
	input := bufio.NewReader(os.Stdin)
	if err := launch(input); err != nil {
		fmt.Fprintln(os.Stderr, "\nClausebook could not start:", err)
		fmt.Print("Press Enter to close. ")
		_, _ = input.ReadString('\n')
		os.Exit(1)
	}
}

func launch(input *bufio.Reader) error {
	local := os.Getenv("LOCALAPPDATA")
	if local == "" {
		return errors.New("LOCALAPPDATA is unavailable")
	}
	root := filepath.Join(local, "Clausebook")
	if err := os.MkdirAll(root, 0700); err != nil {
		return err
	}
	project, err := installPayload(root, payload)
	if err != nil {
		return err
	}
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	config, err := chooseConfig(filepath.Dir(executable), root)
	if err != nil {
		return err
	}
	if err := createConfig(config, filepath.Join(project, ".env.example")); err != nil {
		return err
	}
	missing, err := missingKeys(config)
	if err != nil {
		return err
	}
	if len(missing) != 0 {
		fmt.Println("Fill in the following values in", config)
		for _, name := range missing {
			if name == "DATABASE_URL" {
				fmt.Println("  DATABASE_URL (paste your Atlas connection string and include /clausebook before the ?)")
			} else {
				fmt.Println("  " + name)
			}
		}
		if err := exec.Command("notepad.exe", config).Start(); err != nil {
			fmt.Println("Open that file in your text editor.")
		}
		fmt.Print("Save the file, then press Enter here. ")
		if _, err := input.ReadString('\n'); err != nil {
			return errors.New("save the .env file and run the launcher again")
		}
		missing, err = missingKeys(config)
		if err != nil {
			return err
		}
		if len(missing) != 0 {
			return fmt.Errorf("the .env file still needs %s", strings.Join(missing, ", "))
		}
	}

	docker := findDocker()
	if docker == "" {
		return errors.New("install Docker Desktop, then run the launcher again")
	}
	contextName, err := waitForDocker(docker)
	if err != nil {
		return err
	}
	if !succeeds(docker, "--context", contextName, "compose", "version") {
		return errors.New("Docker Compose is unavailable. Update Docker Desktop")
	}
	fmt.Println("Starting Clausebook with MongoDB Atlas. The first build may take a few minutes.")
	command := exec.Command(docker, "--context", contextName, "compose",
		"--project-name", "clausebook", "--project-directory", project,
		"--env-file", config, "-f", filepath.Join(project, "compose.yaml"),
		"up", "--build", "--detach", "--wait")
	command.Dir = project
	command.Env = append(cleanDockerEnv(), "CLAUSEBOOK_ENV_FILE="+config)
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr
	if err := command.Run(); err != nil {
		return fmt.Errorf("Docker Compose failed: %w", err)
	}
	if err := waitForWeb(); err != nil {
		return err
	}
	fmt.Println("Clausebook is ready at", appURL)
	if err := exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", appURL).Start(); err != nil {
		fmt.Println("Open the URL above in your browser.")
		fmt.Print("Press Enter to close. ")
		_, _ = input.ReadString('\n')
	}
	return nil
}

func installPayload(root string, contents []byte) (string, error) {
	hash := sha256.Sum256(contents)
	version := fmt.Sprintf("app-%x", hash[:6])
	final := filepath.Join(root, version)
	if _, err := os.Stat(filepath.Join(final, "compose.yaml")); err == nil {
		return final, nil
	}
	archive, err := zip.NewReader(bytes.NewReader(contents), int64(len(contents)))
	if err != nil {
		return "", err
	}
	staging, err := os.MkdirTemp(root, "install-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(staging)
	for _, entry := range archive.File {
		if !validEntry(entry.Name) || !entry.Mode().IsRegular() {
			return "", fmt.Errorf("invalid application archive entry %q", entry.Name)
		}
		output := filepath.Join(staging, filepath.FromSlash(entry.Name))
		if err := os.MkdirAll(filepath.Dir(output), 0700); err != nil {
			return "", err
		}
		if err := extractFile(entry, output); err != nil {
			return "", err
		}
	}
	if err := os.Rename(staging, final); err != nil {
		// Other invocations may have installed this exact payload while we extracted it.
		if _, statErr := os.Stat(filepath.Join(final, "compose.yaml")); statErr != nil {
			return "", err
		}
	}
	return final, nil
}

func validEntry(name string) bool {
	return name != "." && fs.ValidPath(name) && path.Clean(name) == name &&
		!strings.ContainsAny(name, "\\:") && path.Base(name) != ".env"
}

func extractFile(entry *zip.File, output string) error {
	source, err := entry.Open()
	if err != nil {
		return err
	}
	defer source.Close()
	dest, err := os.OpenFile(output, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(dest, source)
	return errors.Join(copyErr, dest.Close())
}

func chooseConfig(executableDir, appRoot string) (string, error) {
	beside := filepath.Join(executableDir, ".env")
	info, err := os.Stat(beside)
	if err == nil {
		if !info.Mode().IsRegular() {
			return "", errors.New("the .env beside the launcher must be a file")
		}
		return beside, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	return filepath.Join(appRoot, ".env"), nil
}

func createConfig(filename, template string) error {
	data, err := os.ReadFile(template)
	if err != nil {
		return err
	}
	dest, err := os.OpenFile(filename, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if errors.Is(err, os.ErrExist) {
		return nil
	}
	if err != nil {
		return err
	}
	_, copyErr := dest.Write(data)
	return errors.Join(copyErr, dest.Close())
}

func missingKeys(filename string) ([]string, error) {
	file, err := os.Open(filename)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	values := map[string]string{}
	for scanner.Scan() {
		line := strings.TrimSpace(strings.TrimPrefix(scanner.Text(), "\uFEFF"))
		line = strings.TrimPrefix(line, "export ")
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		value = strings.TrimSpace(value)
		if strings.HasPrefix(value, "#") {
			value = ""
		}
		values[strings.TrimSpace(key)] = strings.Trim(value, `"'`)
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	var missing []string
	for _, name := range []string{"CLERK_PUBLISHABLE_KEY", "CLERK_JWT_KEY", "OPENROUTER_API_KEY"} {
		if strings.TrimSpace(values[name]) == "" {
			missing = append(missing, name)
		}
	}
	if !looksLikeAtlasURI(values["DATABASE_URL"]) {
		missing = append(missing, "DATABASE_URL")
	}
	return missing, nil
}

func looksLikeAtlasURI(uri string) bool {
	scheme, address, hasScheme := strings.Cut(strings.TrimSpace(uri), "://")
	if !hasScheme || (scheme != "mongodb+srv" && scheme != "mongodb") ||
		strings.ContainsAny(uri, "<> \t") {
		return false
	}
	path, _, _ := strings.Cut(address, "?")
	authority, database, hasDatabase := strings.Cut(path, "/")
	if !hasDatabase || database == "" || strings.Contains(database, "/") {
		return false
	}
	host := authority[strings.LastIndex(authority, "@")+1:]
	host = strings.ToLower(host)
	return host != "" && host != "localhost" && !strings.HasPrefix(host, "localhost:") &&
		!strings.HasPrefix(host, "127.") && !strings.HasPrefix(host, "[::1]")
}

func dockerDesktopBinary(parts ...string) string {
	for _, root := range []string{os.Getenv("ProgramW6432"), os.Getenv("ProgramFiles")} {
		if root == "" {
			continue
		}
		base := []string{root, "Docker", "Docker"}
		candidate := filepath.Join(append(base, parts...)...)
		if stat, err := os.Stat(candidate); err == nil && !stat.IsDir() {
			return candidate
		}
	}
	return ""
}

func findDocker() string {
	if binary, err := exec.LookPath("docker.exe"); err == nil {
		return binary
	}
	return dockerDesktopBinary("resources", "bin", "docker.exe")
}

func cleanDockerEnv() []string {
	env := os.Environ()
	clean := make([]string, 0, len(env))
	for _, assignment := range env {
		name, _, _ := strings.Cut(assignment, "=")
		switch strings.ToUpper(name) {
		case "DOCKER_HOST", "DOCKER_CONTEXT", "CLAUSEBOOK_ENV_FILE":
			continue
		}
		clean = append(clean, assignment)
	}
	return clean
}

func output(docker string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, docker, args...)
	command.Env = cleanDockerEnv()
	return command.Output()
}

func succeeds(docker string, args ...string) bool {
	_, err := output(docker, args...)
	return err == nil
}

func localDockerContext(docker string) string {
	for _, name := range []string{"desktop-linux", "default"} {
		value, err := output(docker, "context", "inspect", name, "--format", "{{.Endpoints.docker.Host}}")
		if err != nil || !strings.HasPrefix(strings.TrimSpace(string(value)), "npipe://") {
			continue
		}
		version, err := output(docker, "--context", name, "info", "--format", "{{.OSType}}")
		if err == nil && strings.TrimSpace(string(version)) == "linux" {
			return name
		}
	}
	return ""
}

func waitForDocker(docker string) (string, error) {
	if current := localDockerContext(docker); current != "" {
		return current, nil
	}
	desktop := dockerDesktopBinary("Docker Desktop.exe")
	if desktop == "" {
		return "", errors.New("start a local Docker Desktop engine in Linux container mode")
	}
	fmt.Println("Waiting for Docker Desktop to start.")
	if err := exec.Command(desktop).Start(); err != nil {
		return "", errors.New("could not open Docker Desktop. Start it manually and try again")
	}
	deadline := time.Now().Add(120 * time.Second)
	for time.Now().Before(deadline) {
		time.Sleep(2 * time.Second)
		if current := localDockerContext(docker); current != "" {
			return current, nil
		}
	}
	return "", errors.New("Docker Desktop did not become ready. Finish starting it in Linux container mode and run the launcher again")
}

func waitForWeb() error {
	client := &http.Client{Timeout: 1500 * time.Millisecond}
	for attempt := 0; attempt < 40; attempt++ {
		response, err := client.Get(appURL + "config")
		if err == nil {
			response.Body.Close()
			if response.StatusCode == http.StatusOK {
				return nil
			}
		}
		time.Sleep(time.Second)
	}
	return errors.New("the app did not become ready. Run docker compose --project-name clausebook logs app to check the application")
}
