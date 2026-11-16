// Dev-only: set the table's slow motion (SCALE=0.25; 1 = real time) and optionally press a menu
// button (PRESS=start) through the app's normal handler, for screenshots of short animations.
export default async function run({ frame }) {
  return frame.evaluate(
    ({ scale, press }) => {
      const app = window.chaos;
      app.timeScale = scale;
      if (press) app.press(press);
      return { timeScale: app.timeScale, screen: app.screen };
    },
    { scale: Number(process.env.SCALE ?? 1), press: process.env.PRESS ?? '' },
  );
}
