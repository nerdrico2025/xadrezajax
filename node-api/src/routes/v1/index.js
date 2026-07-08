const { Router } = require("express");
const gameRoutes = require("./game.routes");

const router = Router();

router.use("/game", gameRoutes);

module.exports = router;
