// Common timezone list for schedule selectors
export const TIMEZONES = [
  { value: 'UTC',                    label: 'UTC' },
  { value: 'Europe/London',          label: 'London (GMT/BST)' },
  { value: 'Europe/Paris',           label: 'Paris / Berlin (CET)' },
  { value: 'Europe/Warsaw',          label: 'Warsaw (CET)' },
  { value: 'Europe/Athens',          label: 'Athens / Helsinki (EET)' },
  { value: 'Asia/Jerusalem',         label: 'Jerusalem (IST)' },
  { value: 'Asia/Dubai',             label: 'Dubai (GST)' },
  { value: 'Asia/Kolkata',           label: 'India (IST +5:30)' },
  { value: 'Asia/Bangkok',           label: 'Bangkok / Jakarta (ICT)' },
  { value: 'Asia/Singapore',         label: 'Singapore / KL (SGT)' },
  { value: 'Asia/Shanghai',          label: 'China / Hong Kong (CST)' },
  { value: 'Asia/Tokyo',             label: 'Tokyo (JST)' },
  { value: 'Australia/Sydney',       label: 'Sydney (AEST)' },
  { value: 'Pacific/Auckland',       label: 'Auckland (NZST)' },
  { value: 'America/New_York',       label: 'New York (ET)' },
  { value: 'America/Chicago',        label: 'Chicago (CT)' },
  { value: 'America/Denver',         label: 'Denver (MT)' },
  { value: 'America/Los_Angeles',    label: 'Los Angeles (PT)' },
  { value: 'America/Sao_Paulo',      label: 'São Paulo (BRT)' },
  { value: 'Africa/Cairo',           label: 'Cairo (EET)' },
  { value: 'Africa/Johannesburg',    label: 'Johannesburg (SAST)' },
];

/**
 * Populate a <select> element with timezone options.
 * @param {HTMLSelectElement} sel
 * @param {string} [current] - currently selected value
 */
export function populateTimezoneSelect(sel, current = 'UTC') {
  sel.innerHTML = TIMEZONES.map(tz =>
    `<option value="${tz.value}"${tz.value === current ? ' selected' : ''}>${tz.label}</option>`
  ).join('');
}
