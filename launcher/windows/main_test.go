package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestArchiveAndConfig(t *testing.T) {
	root := t.TempDir()
	project, err := installPayload(root, payload)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range []string{".env.example", "compose.yaml", "package.json", "app", "lib", "pnpm-lock.yaml"} {
		if _, err := os.Stat(filepath.Join(project, item)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := os.Stat(filepath.Join(project, ".env")); !os.IsNotExist(err) {
		t.Fatal("launcher archive must contain only the example environment file")
	}
	reinstall, err := installPayload(root, payload)
	if reinstall != project || err != nil {
		t.Fatalf("repeat install returned %q, %v", reinstall, err)
	}

	config := filepath.Join(root, ".env")
	template := filepath.Join(project, ".env.example")
	if err := createConfig(config, template); err != nil {
		t.Fatal(err)
	}
	if missing, err := missingKeys(config); len(missing) != 4 || err != nil {
		t.Fatalf("expected four empty required fields, got %v, %v", missing, err)
	}
	filled := "CLERK_PUBLISHABLE_KEY=test\nCLERK_JWT_KEY=test\nOPENROUTER_API_KEY=test\nDATABASE_URL=mongodb+srv://dbuser:fixture@cluster.example.mongodb.net/clausebook?retryWrites=true\n"
	if err := os.WriteFile(config, []byte(filled), 0600); err != nil {
		t.Fatal(err)
	}
	if err := createConfig(config, template); err != nil {
		t.Fatal(err)
	}
	if got, _ := os.ReadFile(config); string(got) != filled {
		t.Fatal("running the launcher again changed the environment")
	}
	if missing, err := missingKeys(config); len(missing) != 0 || err != nil {
		t.Fatalf("unexpected missing fields: %v, %v", missing, err)
	}
}

func TestArchivePathValidation(t *testing.T) {
	for _, invalid := range []string{"../.env", "/etc/passwd", "app/../../x", "x\\..\\file", "C:x", ".env", "app/.env"} {
		if validEntry(invalid) {
			t.Errorf("accepted invalid archive entry %q", invalid)
		}
	}
	if !validEntry("app/api/config.js") || !validEntry(".env.example") {
		t.Fatal("rejected valid archive entries")
	}
}

func TestExistingEnvBesideLauncher(t *testing.T) {
	executableDir := t.TempDir()
	root := t.TempDir()
	config, err := chooseConfig(executableDir, root)
	if err != nil || config != filepath.Join(root, ".env") {
		t.Fatalf("expected the existing installer config location, got %q, %v", config, err)
	}
	beside := filepath.Join(executableDir, ".env")
	old := "CLERK_PUBLISHABLE_KEY=test\nCLERK_JWT_KEY=test\nOPENROUTER_API_KEY=test\nDATABASE_URL=mongodb://127.0.0.1:27017/clausebook?replicaSet=rs0\n"
	if err := os.WriteFile(beside, []byte(old), 0600); err != nil {
		t.Fatal(err)
	}
	config, err = chooseConfig(executableDir, root)
	if err != nil || config != beside {
		t.Fatalf("expected the .env beside the launcher, got %q, %v", config, err)
	}
	missing, err := missingKeys(config)
	if err != nil || len(missing) != 1 || missing[0] != "DATABASE_URL" {
		t.Fatalf("expected only the Atlas URL to need editing, got %v, %v", missing, err)
	}
	if got, err := os.ReadFile(config); err != nil || string(got) != old {
		t.Fatal("checking an existing .env changed its contents")
	}
}

func TestAtlasURIValidation(t *testing.T) {
	for _, invalid := range []string{
		"", "mongodb+srv://user:<password>@atlas.example.mongodb.net/clausebook",
		"mongodb+srv://user:pw@atlas.example.mongodb.net/?retryWrites=true",
		"mongodb://localhost:27017/clausebook", "mongodb://[::1]:27017/clausebook",
	} {
		if looksLikeAtlasURI(invalid) {
			t.Errorf("accepted invalid Atlas URI %q", invalid)
		}
	}
	for _, valid := range []string{
		"mongodb+srv://user:one%40two@atlas.example.mongodb.net/clausebook?retryWrites=true&w=majority",
		"mongodb://user:pw@one.mongodb.net:27017,two.mongodb.net:27017/clausebook?tls=true",
	} {
		if !looksLikeAtlasURI(valid) {
			t.Errorf("rejected valid Atlas URI %q", valid)
		}
	}
}
