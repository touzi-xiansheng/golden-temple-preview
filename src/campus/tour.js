import { CatmullRomCurve3, Vector3, MathUtils } from 'three';

export const SHOT_SECONDS = 10;
export const TOUR = [
  { name: '抵达 · 花园中的园区', detail: '两座庭院，连接工作与日常', points: [[98, 72, 116], [83, 57, 104], [68, 43, 89]], look: [[0, 10, 3], [0, 9, 5]], fov: 46 },
  { name: '入园 · 花园门廊', detail: '从街道走进绿意', points: [[2, 1.7, 91], [2, 1.72, 75], [0, 1.75, 55]], look: [[0, 6, 25], [-2, 6, 9]], fov: 42 },
  { name: '漫步 · 阳光庭院', detail: '草坪、花境与树下的光斑', points: [[8, 1.72, 48.7], [13.8, 1.75, 41], [17.6, 1.75, 33.5]], look: [[-15, 4, 25], [-16, 5, 8]], fov: 48 },
  { name: '林下 · 办公花园', detail: '树冠围合，步道穿行', points: [[10, 1.7, -5.3], [16.1, 1.72, -17.4], [15, 1.75, -30.7]], look: [[-7, 4, -28], [-4, 7, -61]], fov: 48 },
  { name: '廊间 · 光与阴影', detail: '檐下的安静，庭院的明亮', points: [[-22.1, 1.7, -6], [-22.1, 1.72, -16], [-22.1, 1.75, -29]], look: [[-22, 2.2, -38], [-21.7, 2.5, -54]], fov: 50 },
  { name: '远望 · 共生之境', detail: '让建筑成为花园的边界', points: [[49, 26, 77], [70, 43, 95], [98, 72, 116]], look: [[0, 9, 3], [0, 10, 3]], fov: 46 },
];
export const DURATION = TOUR.length * SHOT_SECONDS;
const curves = TOUR.map(s => new CatmullRomCurve3(s.points.map(p => new Vector3(...p)), false, 'centripetal'));
const targets = TOUR.map(s => s.look.map(p => new Vector3(...p)));

export function sampleTour(seconds) {
  const time = ((seconds % DURATION) + DURATION) % DURATION;
  const index = Math.floor(time / SHOT_SECONDS);
  const fraction = (time % SHOT_SECONDS) / SHOT_SECONDS;
  const u = MathUtils.lerp(fraction, fraction * fraction * (3 - 2 * fraction), 0.4);
  return { index, position: curves[index].getPoint(u), target: targets[index][0].clone().lerp(targets[index][1], u), fov: TOUR[index].fov };
}
