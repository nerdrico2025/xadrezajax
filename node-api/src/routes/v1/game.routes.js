const { Router } = require("express");
const { move } = require("../../controllers/game.controller");
const { requireAuth } = require("../../middleware/auth");

const router = Router();

// A engine é o recurso mais caro do serviço — nunca anônima.
router.post("/move", requireAuth, move);

module.exports = router;
