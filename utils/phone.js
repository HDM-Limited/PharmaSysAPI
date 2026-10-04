function normalizePhone(input, defaultCountry = '254') {
  if (!input) return null;
  const digits = String(input).replace(/\D/g, '');
  if (!digits) return null;

  if (digits.startsWith(defaultCountry)) return digits;
  if (digits.startsWith('0')) return `${defaultCountry}${digits.slice(1)}`;
  if (digits.length === 9) return `${defaultCountry}${digits}`;
  return digits;
}

function isValidKenyanPhone(input) {
  const p = normalizePhone(input, '254');
  if (!p) return false;
  return /^254(7|1)\d{8}$/.test(p);
}

module.exports = { normalizePhone, isValidKenyanPhone };