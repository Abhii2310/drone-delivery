import random

from models import Corridor, Decision, Destination, Drone, Hub, Incident, LandingZone, Mission, Route, Zone


class AppState:
    def __init__(self) -> None:
        self.drones: dict[str, Drone] = {}
        self.routes: dict[str, Route] = {}
        self.missions: dict[str, Mission] = {}
        self.zones: dict[str, Zone] = {}
        self.corridors: dict[str, Corridor] = {}
        self.hubs: dict[str, Hub] = {}
        self.landing_zones: dict[str, LandingZone] = {}
        self.destinations: dict[str, Destination] = {}
        self.incidents: dict[str, Incident] = {}
        self.decisions: dict[str, Decision] = {}
        self.policies: list[dict] = []
        self.audit: list[dict] = []
        self.noise_ledger: list[dict] = []
        self.ai_enabled: bool = True
        self.weather: dict = {"wind_speed": 8.2, "wind_direction": 241.0, "visibility_m": 9400.0}
        self.sim_clock: float = 0.0
        self.revision: int = 0
        self.emergency: dict | None = None
        self.rng = random.Random(1337)

    def reset(self) -> None:
        import city
        import simulator

        revision = self.revision
        self.__init__()
        city.load(self)
        simulator.seed(self)
        self.revision = revision + 1


state = AppState()
