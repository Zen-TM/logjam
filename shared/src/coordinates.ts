// A latitude, longitude pair pasted into one coordinate field. Both clients
// have coordinate entry, so the split is decided here: a pair that reads
// clearly is split across the two fields, and anything else is left exactly
// as typed for the field's own validation to flag. Digits are never joined.

export type CoordinatePair = { latitude: number; longitude: number };
type Axis = keyof CoordinatePair;

const NUMBER = String.raw`[+-]?(?:\d+(?:\.\d*)?|\.\d+)`;
const HEMISPHERE = "[NSEWnsew]";
// One half: a hemisphere letter before or after its number, or neither.
const PART = `(?:(${HEMISPHERE})\\s*(${NUMBER})|(${NUMBER})\\s*(${HEMISPHERE})?)`;
const PAIR = new RegExp(`^${PART}(\\s*[,;\\t]\\s*|\\s+)${PART}$`);

function half(
  letterBefore: string | undefined,
  numberAfterLetter: string | undefined,
  numberBefore: string | undefined,
  letterAfter: string | undefined,
): { value: number; axis: Axis | null } | null {
  const letter = (letterBefore ?? letterAfter)?.toUpperCase();
  const number = Number(numberAfterLetter ?? numberBefore);
  if (!letter) return { value: number, axis: null };
  // "-33.6 S" says the sign twice.
  if (number < 0) return null;
  const south = letter === "S" || letter === "W";
  return {
    value: south ? -number : number,
    axis: letter === "N" || letter === "S" ? "latitude" : "longitude",
  };
}

/**
 * "-33.6290, 150.3156" as latitude and longitude. The halves may be split by
 * a comma, semicolon, tab or spaces, carry degree signs, and say N, S, E or W
 * before or after the number; letters decide the order, else it is latitude
 * first. Null for anything else, including a decimal comma ("-33,6290") and
 * a pair outside the globe.
 */
export function parseCoordinatePair(text: string): CoordinatePair | null {
  const plain = text.replace(/[°º]/g, "").replace(/−/g, "-").trim();
  // Two whole numbers on a bare comma are one number with a decimal comma.
  if (/^[+-]?\d+,\d+$/.test(plain)) return null;
  const match = PAIR.exec(plain);
  if (!match) return null;
  const first = half(match[1], match[2], match[3], match[4]);
  const second = half(match[6], match[7], match[8], match[9]);
  if (!first || !second) return null;
  // "S33 52.512" is a degrees-minutes latitude, not a pair: with only spaces
  // between, a letter on one half and not the other is not enough to tell.
  if (!/[,;\t]/.test(match[5]) && !first.axis !== !second.axis) return null;
  // Two latitudes, or two longitudes.
  if (first.axis && first.axis === second.axis) return null;
  // A letter on one half names the other half's axis too.
  const firstAxis: Axis =
    first.axis ?? (second.axis === "latitude" ? "longitude" : "latitude");
  const [latitude, longitude] =
    firstAxis === "latitude"
      ? [first.value, second.value]
      : [second.value, first.value];
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  // `|| 0`: no "-0" in the field.
  return { latitude: latitude || 0, longitude: longitude || 0 };
}

/** The previous text with one character typed into it. */
function isKeystroke(text: string, previous: string): boolean {
  if (text.length !== previous.length + 1) return false;
  let at = 0;
  while (at < previous.length && text[at] === previous[at]) at += 1;
  return text.slice(at + 1) === previous.slice(at);
}

/** A coordinate field's text as a number: NaN for empty text and for
 *  anything that is not wholly a number. `parseFloat` reads "-33.6, 150" as
 *  -33.6, and `Number("")` is 0. */
export function coordinateNumber(text: string): number {
  return text.trim() === "" ? NaN : Number(text);
}

/**
 * What a coordinate field's text becomes: a pasted pair fills both fields,
 * anything else is only this field's text, untouched. A keystroke never
 * splits, so typing a pair does not cut it in two at the first digit of its
 * second half.
 */
export function coordinateEntry(
  text: string,
  axis: Axis,
  previous: string,
): Partial<Record<Axis, string>> {
  const pair = isKeystroke(text, previous) ? null : parseCoordinatePair(text);
  return pair
    ? { latitude: String(pair.latitude), longitude: String(pair.longitude) }
    : { [axis]: text };
}
