// Ρυθμίσεις που δεν αλλάζει ο χρήστης: διακομιστές και όρια της πλοήγησης.

export const APP_VERSION = "v2.11.0"; // ίδιο με το VERSION στο sw.js

export const SERVERS = {
  route: [
    "https://router.project-osrm.org/route/v1/driving/",
    "https://routing.openstreetmap.de/routed-car/route/v1/driving/",
  ],
  // με τα πόδια: μόνο ο διακομιστής FOSSGIS έχει διαδρομές για πεζούς
  walk: ["https://routing.openstreetmap.de/routed-foot/route/v1/driving/"],
  photon: "https://photon.komoot.io/api/",
  nominatim: "https://nominatim.openstreetmap.org/search",
  // Esri: διευθύνσεις με αριθμό που λείπουν από το OpenStreetMap (π.χ. σε μικρές πόλεις της Αμερικής)
  arcgis: "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates",
  arcgisReverse: "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode",
  photonReverse: "https://photon.komoot.io/reverse",
  overpass: [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
  ],
  tiles: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  // Δορυφόρος: δωρεάν παγκόσμιες εικόνες της Esri, με δρόμους και ονόματα από πάνω
  satellite: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  satRoads: "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}",
  satLabels: "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
};

export const NAV = {
  OFF_ROUTE_M: 60,        // πόσο μακριά από τη γραμμή = εκτός διαδρομής
  OFF_ROUTE_WALK_M: 40,   // …για πεζούς
  OFF_ROUTE_FIXES: 3,     // πόσες συνεχόμενες θέσεις εκτός πριν ξαναϋπολογίσει
  PASSED_M: 8,            // πόσο μετά τη στροφή θεωρείται «περασμένη»
  BACKTRACK_M: 60,        // μόνο αν γυρίσεις πίσω τόσο, ξαναγυρίζει σε προηγούμενη στροφή
  ARRIVE_M: 25,
  WARN_CITY: [800, 300],            // προειδοποιήσεις πριν από τη στροφή (μέτρα)
  WARN_HIGHWAY: [2000, 1000, 400],
  WARN_WALK: [150, 50],
  IDLE_S: 90,
  GPS_LOST_MS: 10000,
  REROUTE_RETRY_MS: 5000, // πρώτη επανάληψη· μετά 10″, 20″, 30″ όσο δεν ξαναμπαίνεις στη διαδρομή
  REROUTE_GRACE_MS: 15000, // μετά από νέα διαδρομή: χρόνος να «κουμπώσει» πριν κριθεί ξανά εκτός
  REPEAT_GAP_MS: 25000,    // η ίδια φράση δεν ξαναλέγεται πιο σύντομα από αυτό
};

export const SEARCH = {
  NEAR_BOX: 0.6,          // μοίρες (~65 χλμ) γύρω σου: εκεί ψάχνουμε πρώτα
};

export const DEFAULT_VIEW = { lat: 37.9838, lng: 23.7275, zoom: 13 };

// Κατηγορίες για τις ατάκες και τις δικές σου ηχογραφήσεις (τα ονόματα: i18n.js, "qc.*").
export const QUIP_KEYS = ["start", "left", "right", "straight", "uturn", "roundabout", "highway", "recalc", "speeding", "idle", "arrive"];
