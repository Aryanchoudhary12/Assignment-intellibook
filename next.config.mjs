const config = {
  poweredByHeader: false,
  serverExternalPackages: ["@prisma/client"],
  devIndicators: false,
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        {key: "X-Content-Type-Options", value: "nosniff"},
        {key: "Referrer-Policy", value: "strict-origin-when-cross-origin"},
      ],
    }];
  },
};

export default config;
