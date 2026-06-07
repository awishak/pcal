// Street addresses for game locations, keyed by the schedule's location name.
// Used to show a tappable Google Maps link next to the location wherever it
// appears. Add a key here when a new venue is used.
export const LOCATION_ADDRESSES = {
  "Livermore": "4444 East Ave, Livermore, CA",
  "Sacramento": "2511 Warren Dr, Rocklin, CA",
  "Modesto": "Manteca High School, 296 S. Garfield Ave, Manteca, CA",
};

export function locationAddress(location) {
  return (location && LOCATION_ADDRESSES[location]) || null;
}

export function mapsUrl(address) {
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(address);
}
