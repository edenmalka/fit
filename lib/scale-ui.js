// Small UI helper with no three.js dependency (used by customer pages too).

/** Puts "W × D × H ס״מ" into a chip, with the numbers kept left-to-right. */
export function showSize(chip, { w, d, h }) {
  chip.innerHTML = '';
  const nums = document.createElement('bdi');
  nums.dir = 'ltr';
  nums.textContent = `${w} × ${d} × ${h}`;
  chip.append(nums, ' ס״מ');
  chip.title = 'רוחב × עומק × גובה';
  chip.hidden = false;
}
