import { DEFAULT_PLANE_SHAPE } from '@aero/shared'
import type { PlacedPlane, Shot } from '@aero/shared'
import { useAppStore } from '../store/appStore'
import { PaperButton } from '../components/ui/PaperButton'
import { PaperCard } from '../components/ui/PaperCard'
import { PaperGrid } from '../components/grid/PaperGrid'
import { StampMark } from '../components/grid/StampMark'

const DEMO_PLANES: PlacedPlane[] = [{ id: 0, rotation: 0, origin: { r: 0, c: 0 } }]
const DEMO_PLANES_ROT: PlacedPlane[] = [{ id: 1, rotation: 1, origin: { r: 0, c: 0 } }]
const DEMO_SHOTS: Shot[] = [
  { coord: { r: 0, c: 0 }, outcome: 'miss' },
  { coord: { r: 1, c: 4 }, outcome: 'hit' },
  { coord: { r: 0, c: 2 }, outcome: 'kill' },
]

export function Rules() {
  const setView = useAppStore((s) => s.setView)

  return (
    <div className="page rules">
      <PaperButton size="sm" variant="ghost" className="page__back" onClick={() => setView('home')}>
        ← 返回主页
      </PaperButton>
      <header className="page__head">
        <div>
          <h1 className="page__title">规则说明</h1>
          <p className="page__subtitle">纸面海战 · 一页纸讲完的规则（以 docs/design.md §1 为准）。</p>
        </div>
      </header>

      <div className="page__body">
        <PaperCard tape>
          <section className="rules__section">
            <h2 className="rules__h">
              <span className="rules__no">①</span> 棋盘与飞机
            </h2>
            <p className="rules__p">
              对战在正方形网格上进行：小型 10×10、中型 15×15、大型 20×20，或自定义（10–26）。
              横坐标为字母（A 起），纵坐标为数字（1 起），报点如 A5。
            </p>
            <p className="rules__p">
              默认飞机为 4 行 × 5 列共 10 格：机头 1、机翼 5、机身 1、机尾 3，左右对称，四向旋转均合法。
              自定义飞机在 5×5 内绘制，需四邻连通、2~15 格、恰 1 个机头。
            </p>
            <div className="rules__diagram-row">
              <figure className="rules__fig">
                <PaperGrid
                  width={5}
                  height={5}
                  cellSize={26}
                  showLabels
                  planes={DEMO_PLANES}
                  shape={DEFAULT_PLANE_SHAPE}
                  invertMarks={false}
                  ariaLabel="默认飞机形状示意"
                />
                <figcaption className="rules__fig-caption">默认飞机形状（机头为深色座舱）</figcaption>
              </figure>
              <figure className="rules__fig">
                <PaperGrid
                  width={5}
                  height={5}
                  cellSize={26}
                  showLabels
                  planes={DEMO_PLANES_ROT}
                  shape={DEFAULT_PLANE_SHAPE}
                  invertMarks={false}
                  ariaLabel="飞机旋转示意"
                />
                <figcaption className="rules__fig-caption">飞机严格占满所属格位，可四向旋转</figcaption>
              </figure>
            </div>
          </section>

          <section className="rules__section">
            <h2 className="rules__h">
              <span className="rules__no">②</span> 报点与反馈
            </h2>
            <p className="rules__p">
              双方轮流报点，格式“字母+数字”，大小写与空格均容错。已报点格不可重复报点。
            </p>
            <ul className="rules__ul">
              <li className="rules__li">无飞机 → <strong>击空</strong>（✗ 黑叉）</li>
              <li className="rules__li">命中非机头部件 → <strong>击中</strong>（◯ 深绿空心圈）</li>
              <li className="rules__li">命中机头 → <strong>击毁</strong>（★ 深红五角星，仅标机头格）</li>
            </ul>
            <p className="rules__p">
              被击毁飞机的其余格位一律不公开；之后对残骸任意格报点，按“击空”返回。
              <strong>残骸与空格在对方眼中不可区分</strong>——误导对手是核心策略。
            </p>
            <div className="rules__diagram-row">
              <figure className="rules__fig">
                <PaperGrid
                  width={5}
                  height={5}
                  cellSize={24}
                  showLabels
                  planes={DEMO_PLANES}
                  shape={DEFAULT_PLANE_SHAPE}
                  destroyedPlaneIds={[0]}
                  shots={DEMO_SHOTS}
                  invertMarks={false}
                  ariaLabel="我方视角：残骸暗色标出"
                />
                <figcaption className="rules__fig-caption">我方视角：被毁飞机暗色标出（仅本人可见）</figcaption>
              </figure>
              <figure className="rules__fig">
                <PaperGrid
                  width={5}
                  height={5}
                  cellSize={24}
                  showLabels
                  shots={DEMO_SHOTS}
                  invertMarks={false}
                  ariaLabel="对手视角：只有标记"
                />
                <figcaption className="rules__fig-caption">对手视角：只有标记，残骸与空格不可区分</figcaption>
              </figure>
            </div>
          </section>

          <section className="rules__section">
            <h2 className="rules__h">
              <span className="rules__no">③</span> 胜负
            </h2>
            <p className="rules__p">
              轮流报点，一方全部飞机被击毁则另一方获胜。终局公开双方真实阵型。
            </p>
          </section>

          <section className="rules__section">
            <h2 className="rules__h">
              <span className="rules__no">④</span> 绝地反击
            </h2>
            <p className="rules__p">
              仅当先手方一次行动击毁对方全部飞机、且自身恰剩 1 架时触发：后手获一次额外报点，
              命中机头则后手胜；其余情形（击中非机头 / 击空 / 命中残骸）判先手胜。
              后手自己全歼不触发；先手剩 ≥2 架直接判先手胜。
            </p>
          </section>

          <section className="rules__section">
            <h2 className="rules__h">
              <span className="rules__no">⑤</span> 数值配置
            </h2>
            <table className="rules__table">
              <thead>
                <tr>
                  <th>档位</th>
                  <th>网格</th>
                  <th>飞机数</th>
                  <th>密度</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>小型</td>
                  <td>10×10</td>
                  <td>3</td>
                  <td>30.0%</td>
                </tr>
                <tr>
                  <td>中型</td>
                  <td>15×15</td>
                  <td>5</td>
                  <td>22.2%</td>
                </tr>
                <tr>
                  <td>大型</td>
                  <td>20×20</td>
                  <td>7</td>
                  <td>17.5%</td>
                </tr>
              </tbody>
            </table>
            <p className="rules__p" style={{ marginTop: 10 }}>
              自定义：飞机数 n ∈ [1, ⌊宽×高÷25⌋]；校验清单常驻（连通性 / 格数 / 机头数），全部满足才可确认。
            </p>
          </section>

          <section className="rules__section" style={{ marginBottom: 0 }}>
            <h2 className="rules__h">
              <span className="rules__no">⑥</span> 标记图例
            </h2>
            <div className="rules__legend" aria-label="标记图例">
              <span className="rules__legend-item">
                <StampMark outcome="miss" size={26} /> 击空
              </span>
              <span className="rules__legend-item">
                <StampMark outcome="hit" size={26} /> 击中
              </span>
              <span className="rules__legend-item">
                <StampMark outcome="kill" size={26} /> 击毁
              </span>
            </div>
            <p className="rules__p" style={{ marginTop: 6 }}>
              提示：可在“设置”中反转 ✗ 与 ◯ 的显示含义。
            </p>
          </section>
        </PaperCard>
      </div>
    </div>
  )
}
