const express = require("express");
const cors = require("cors");
const errorHandler = require("./middleware/errorHandler");
const v1Routes = require("./routes/v1");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "node-api" });
});

app.use("/api/v1", v1Routes);

app.use(errorHandler);

module.exports = app;
