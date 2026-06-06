const { Router } = require("express");
const { move } = require("../../controllers/game.controller");

const router = Router();

router.post("/move", move);

module.exports = router;
