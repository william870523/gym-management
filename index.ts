import server from "./src/infrastructure/http/server";

const port = server.port || 3000;

console.log(`Starting server on port ${port}...`);

Bun.serve({
    port: port,
    fetch: server.fetch,
    // tls: {
    //   cert: Bun.file("cert.pem"),
    //   key: Bun.file("key.pem"),
    // }
});

console.log(`Server running at http://localhost:${port}`);