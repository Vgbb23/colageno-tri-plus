import dotenv from "dotenv";
import app from "./app.js";

dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local", override: true });

const PORT = Number(process.env.API_PORT || 3002);

const server = app.listen(PORT, () => {
  console.log(`API Fruitfy + Utmify rodando na porta ${PORT}`);
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Porta ${PORT} já está em uso. Defina API_PORT no .env.local.`);
    process.exit(1);
  }
  throw err;
});
