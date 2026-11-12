// No WebGL, or the graphics libraries didn't load: say so, and point to the plain pages, which need neither.
const { THREE, Globe } = window;
if (
  !THREE ||
  !Globe ||
  !(() => {
    try {
      const c = document.createElement('canvas');
      return c.getContext('webgl2') || c.getContext('webgl');
    } catch {
      return null;
    }
  })()
) {
  document.querySelector('#loading').innerHTML =
    '<div style="max-width:32em;padding:0 16px;text-align:center;line-height:1.7">The 3D globe can’t run in this browser. <a href="browse.html" style="color:#d9b36a">Read every record as a plain list</a> instead.</div>';
  throw new Error('The globe needs WebGL');
}
