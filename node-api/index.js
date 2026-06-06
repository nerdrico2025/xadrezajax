const app = require("./src/app");

const PORT = process.env.NODE_PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🔥 Node API rodando em http://0.0.0.0:${PORT}`);
});
