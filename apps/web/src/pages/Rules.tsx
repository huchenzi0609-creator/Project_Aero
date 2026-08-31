import { DEFAULT_PLANE_SHAPE } from '@aero/shared'
import type { PlacedPlane, Shot } from '@aero/shared'
import { useAppStore } from '../store/appStore'
import { useEffectiveOrientation } from '../hooks/useOrientation'
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
  const orientation = useEffectiveOrientation()
  // 竖版 9:16 舞台内示意图缩小格位（紧凑双栏排版），横版保持原尺寸
  const cellA = orientation === 'portrait' ? 7 : 26
  const cellB = orientation === 'portrait' ? 6 : 24

  return (
    <div className="page rules">
      <PaperButton size="sm" variant="ghost" className="page__back" onClick={() => setView('home')}>
        ← 返回主页
      </PaperButton>
      <header className="page__head">
        <div>
          <h1 className="page__title">规则说明</h1>
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
                  cellSize={cellA}
                  showLabels={orientation !== 'portrait'}
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
                  cellSize={cellA}
                  showLabels={orientation !== 'portrait'}
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
              双方轮流报点，格式“字母+数字”，大小写与空格均容错。
              重复报点或非法坐标判<strong>无效打击</strong>，该次不消耗回合。
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
                  cellSize={cellB}
                  showLabels={orientation !== 'portrait'}
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
                  cellSize={cellB}
                  showLabels={orientation !== 'portrait'}
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
            <p className="rules__p">
              小型 10×10·3 架（密度 30.0%）；中型 15×15·5 架（22.2%）；大型 20×20·7 架（17.5%）。
            </p>
            <p className="rules__p" style={{ marginTop: 6 }}>
              自定义：飞机数 n ∈ [1, ⌊宽×高÷25⌋]；校验清单常驻（连通性 / 格数 / 机头数），全部满足才可确认。
            </p>
          </section>

          <section className="rules__section">
            <h2 className="rules__h">
              <span className="rules__no">⑥</span> 联机计时
            </h2>
            <p className="rules__p">
              联机采用围棋读秒制：每步默认 30 秒，共 3 次超时机会；机会耗尽后降为 10 秒，
              再超时由电脑（正常难度）接管代打。自定义房间可另选 10/20/30/60 秒或不限。
            </p>
          </section>

          <section className="rules__section">
            <h2 className="rules__h">
              <span className="rules__no">⑦</span> 辅助工具与结算
            </h2>
            <p className="rules__p">
              着色工具：点按开启着色，长按（约 0.5 秒）调出黄/蓝/绿调色板，点按或拖拽为棋盘格染色。
              样式参考飞机可拖拽到对手棋盘上辅助推演，旋转与批量着色可用，可在设置中关闭。
            </p>
            <p className="rules__p">
              结算显示双方平均击杀效率：从首次命中到击毁的平均报点步数，越低越高效。
            </p>
          </section>

          <section className="rules__section" style={{ marginBottom: 0 }}>
            <h2 className="rules__h">
              <span className="rules__no">⑧</span> 标记图例
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
