# AI 色彩测试评测报告（公开人脸数据集）

- 评测对象：`POST https://sg.yaoyuheng2001.me/colorstyle/api/coloranalysis`（内部 GPT-5 视觉，12 季型体系）
- 评测日期：2026-07-02
- 样本量：34 张人脸（+ 6 张 test-retest 复测，共 40 次成功 API 调用）
- 原始数据：`eval/results.jsonl`；本地肤色量：`eval/skin_lab.json`；样本清单：`eval/manifest.json`

## 1. 数据集与方法
最终使用 **FairFace validation（0.25 padding）**，来源 HuggingFace 镜像 `HuggingFaceM4/FairFace`，通过 `datasets-server.huggingface.co/rows` API 直接取图+标签（无需下 63MB parquet/pyarrow）。FairFace 族裔/肤色多样性最好且自带 race/gender/age 标签。备选 LFW/UTKFace 直链在本机不可达，故采用 FairFace。

取样：跨 validation 13 个分散 offset 拉 390 行候选池（7 族裔均衡），按族裔分层每族裔取 5 张（男女交替），1 张签名 URL 过期 → 实得 **34 张**。均为原生 224×224 JPEG（已 ≤512）。

最终族裔分布：White5/East Asian5/Indian5/Middle Eastern5/Latino5/Southeast Asian5/Black4；性别 M21/F13。

客观肤色量（纯 PIL 无 numpy）：中心区域 YCbCr 肤色掩膜 → 肤色像素中位 RGB → CIELAB，取 b*（暖度代理）与 L*（深浅代理），做方向性合理性校验。

调用：严格单并发顺序（上游并发上限=1，并发即 429），间隔 3s，429 退避 12s 重试。单张约 24–30s。

## 2. 结果分布
### 12 季型（n=34）
| 季型 | 计数 |
|---|---|
| 深秋 Deep Autumn | 13 |
| 柔秋 Soft Autumn | 11 |
| 暖秋 True Autumn | 5 |
| 冷夏 True Summer | 2 |
| 冷冬 True Winter | 1 |
| 浅夏 Light Summer | 1 |
| 浅春 Light Spring | 1 |

12 类只用到 7 类；深秋+柔秋占 24/34（71%）。

### 四季（n=34）
| 四季 | 计数 | 占比 |
|---|---|---|
| Autumn | 29 | **85%** |
| Summer | 3 | 9% |
| Winter | 1 | 3% |
| Spring | 1 | 3% |

严重坍缩到「秋」。

### Undertone（n=34）
| undertone | 计数 |
|---|---|
| neutral-warm 中性偏暖 | 30 |
| neutral-cool 中性偏冷 | 4 |

模型只输出「中性偏暖/偏冷」两档，88% 偏暖。解析失败 0，API 失败 0。

## 3. 一致性（test-retest，6 张各复测 1 次）
| face | run1 | run2 | 12型一致 | 四季一致 |
|---|---|---|---|---|
| face_000 | 柔秋 | 柔秋 | ✅ | ✅ |
| face_007 | 冷冬 | 柔秋 | ❌ | ❌ |
| face_013 | 浅夏 | 柔夏 | ❌ | ✅ |
| face_023 | 深秋 | 深秋 | ✅ | ✅ |
| face_028 | 浅春 | 浅春 | ✅ | ✅ |
| face_032 | 深秋 | 暖秋 | ❌ | ✅ |

- **12 季型完全一致率：3/6 = 50%**
- **四季一致率：5/6 = 83%**

四季大类较稳，12 细分型（深/柔/暖秋及跨季边界）抖动明显。

## 4. 偏差校验：undertone vs 实测肤色暖度 b*
| 模型 undertone | n | 实测 b* 均值 | b* 范围 |
|---|---|---|---|
| neutral-warm | 30 | **18.0** | -4.5 .. 39.0 |
| neutral-cool | 4 | **3.4** | -0.0 .. 9.6 |

- 判「偏冷」的实测暖度显著更低（3.4 vs 18.0），方向正确。
- Pearson r(undertone_warm_score, 实测 b*) = **0.497**（n=34，中等正相关）→ 冷暖判定合理，但因几乎只在「偏暖」内取值，分辨率被压缩。

季型深浅 vs 明度 L*：深秋 L*≈36（最低）、浅春 L*≈74（最高），深浅维度合理，模型对明度把握优于冷暖。

## 5. 分族裔分布（偏态检查）
| 族裔 | n | L* | b* | 四季 | undertone |
|---|---|---|---|---|---|
| Black | 4 | 44 | 14.0 | Autumn3, Spring1 | 全 warm |
| East Asian | 5 | 40 | 8.8 | Summer2, Autumn2, Winter1 | cool3/warm2 |
| Indian | 5 | 49 | 17.6 | Autumn4, Summer1 | warm4/cool1 |
| Latino | 5 | 37 | 13.8 | **Autumn5** | 全 warm |
| Middle Eastern | 5 | 48 | 21.1 | **Autumn5** | 全 warm |
| Southeast Asian | 5 | 45 | 17.5 | **Autumn5** | 全 warm |
| White | 5 | 43 | 20.9 | **Autumn5** | 全 warm |

- **East Asian 是唯一冷调聚集群**（cool3/5，实测 b* 最低 8.8）——与客观量一致，合理。
- 其余 6 族裔几乎全判「秋+中性偏暖」；深肤色（Latino/Black）系统性落入深秋，**存在"深肤→判暖/判秋"的潜在偏向**（Black 4 张无一冷调）。

## 6. 局限（诚实声明）
1. **无 ground-truth**：12 季型无客观标签，本评测不给绝对准确率，只评分布/一致性/方向合理性。
2. **样本小**：34 张，冬/春及 Black(n=4) 格子极少，分族裔仅趋势提示不具显著性。
3. **单张受光照影响大**：224×224 光照不受控，是 retest 抖动来源。
4. **本地 b*/L* 为粗略近似**：YCbCr 掩膜+中位像素，未做关键点定位，仅方向参考。
5. **undertone 靠文本正则提取**（本批失败率 0）。

## 7. 结论
- 接口稳定可用（0 失败，需严格单并发）。
- 冷暖方向合理（r=0.50），深浅与明度高度吻合。
- 但分布严重偏态：四季 85% 判秋、undertone 88% 偏暖、12 型只用 7 类且集中深秋/柔秋。
- 潜在族裔偏向：非东亚（尤其深肤）几乎一律「秋+偏暖」，缺冷调出口；东亚是唯一被合理分冷调群体。
- 12 型 test-retest 一致率仅 50%（四季 83%），细分稳定性弱。

## 8. 改进建议
1. **纠正"默认判秋/偏暖"先验**：prompt 中要求先独立判冷暖/明度/浊艳三轴再合成季型，给冷调与冬季型明确判据示例，打破坍缩。
2. **降随机性提可复现**：同脸 2–3 次投票取众数或降温/固定 seed；返回三轴数值化打分（当前只有文本 undertone），利于稳定与审计。
3. **补公平性校验+预处理**：上线前用 FairFace 做例行分布回归（本脚本可复用）；输入先白平衡/光照归一减「偏暖」漂移；为深肤个体保留深冬等冷调出口。

## 附：可复现文件（均在 eval/）
collect_meta.py/meta_pool.json、sample_download.py/manifest.json/faces/、skin_lab.py/skin_lab.json、run_api.py/results.jsonl、analyze.py
