// 季节 → 氛围 知识库：把"测色结果(季型)"映射成成片氛围(场景/光线/表情/发型/调色)，
// 让妆造与穿搭从「单点客观」转向「整体氛围」。注入到生图 prompt。
export const VIBE = {
  春: { scene: '明亮通透的户外花园或浅木色调室内，清晨氛围', light: '清透暖阳、明亮柔和、有轻微逆光辉光', mood: '轻盈元气、眼里有光、松弛微笑', hair: '蓬松自然、发丝通透有光泽', grade: '明亮暖调、清新通透、低颗粒' },
  夏: { scene: '清爽的浅色空间 / 海边薄雾 / 纱帘柔光室内', light: '柔和散射的冷调光、雾感、无硬阴影', mood: '温柔恬静、松弛、若有所思', hair: '柔顺自然、微雾感、发尾轻盈', grade: '低对比冷调、雾面柔和、奶感' },
  秋: { scene: '温暖的咖啡馆 / 秋日街边 / 大地色系室内', light: '黄金时刻暖光、慵懒斜射、暖阴影', mood: '松弛高级、微微沉静、疏离感', hair: '自然微卷或低扎、慵懒碎发', grade: '暖棕大地色调、轻胶片颗粒、复古' },
  冬: { scene: '干净利落的纯色背景 / 都市冷调空间 / 极简画廊', light: '清晰高对比冷光、通透、结构分明', mood: '清冷笃定、气场感、眼神坚定', hair: '利落顺滑、线条清晰、光泽感', grade: '冷调高对比、清透干净、锐利' },
};
export function vibeForSeason(season) {
  const s = season || '';
  const k = /春|Spring/i.test(s) ? '春' : /夏|Summer/i.test(s) ? '夏' : /秋|Autumn/i.test(s) ? '秋' : /冬|Winter/i.test(s) ? '冬' : '秋';
  return { key: k, ...VIBE[k] };
}
export function vibeLine(season) {
  const v = vibeForSeason(season);
  return `场景：${v.scene}；光线：${v.light}；表情：${v.mood}；发型氛围：${v.hair}；整体调色：${v.grade}`;
}
