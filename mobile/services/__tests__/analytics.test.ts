import {
  clearBufferedEvents,
  getBufferedEvents,
  logEvent,
} from "../analytics";

describe("analytics (buffer local, sem provedor)", () => {
  beforeEach(() => clearBufferedEvents());

  it("acumula eventos com nome, propriedades e timestamp", () => {
    logEvent("onboarding_started");
    logEvent("onboarding_completed", { level: "advanced", rating: 1600 });

    const events = getBufferedEvents();
    expect(events).toHaveLength(2);
    expect(events[0].name).toBe("onboarding_started");
    expect(events[1].properties).toEqual({ level: "advanced", rating: 1600 });
    expect(typeof events[1].timestamp).toBe("number");
  });

  it("clearBufferedEvents esvazia o buffer (flush de provedor futuro)", () => {
    logEvent("first_game_started", { difficulty: "easy" });
    clearBufferedEvents();
    expect(getBufferedEvents()).toHaveLength(0);
  });
});
