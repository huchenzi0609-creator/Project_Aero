/**
 * @aero/server —— 游客身份。
 *
 * 规则（docs/design.md §6）：
 * - 首次来访生成「游客XXXXX」（5 位数字，库内唯一，冲突重新生成）；
 * - 随机 token（crypto.randomBytes(32).hex），服务端只存 token 的 sha256；
 * - POST /api/auth {token?} → {identity}：旧 token 命中则复用，否则新建。
 *
 * 明示边界：客户端 token 存 localStorage（键名契约：shared 导出的 GUEST_TOKEN_KEY，
 * 即 'aero:guest:token'）；换浏览器/清缓存即新账号（预期行为）。
 */
import { createHash, randomBytes, randomInt } from 'node:crypto'
import type { GuestIdentity } from '@aero/shared'
import type { Store, UserRow } from './db'

/** token → sha256 十六进制（服务端只存哈希，不存明文） */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

/** 生成「游客XXXXX」：5 位数字，不足前补零 */
export function generateGuestName(): string {
  return `游客${String(randomInt(0, 100000)).padStart(5, '0')}`
}

export class IdentityService {
  constructor(private readonly store: Store) {}

  /** token → 用户；空 token 或未命中返回 null */
  findByToken(token: string): UserRow | null {
    if (!token) return null
    return this.store.findByTokenHash(sha256Hex(token)) ?? null
  }

  /** 首次来访或旧 token 失效时创建新游客账号（重名冲突重新生成） */
  private createGuest(): { user: UserRow; token: string } {
    const token = randomBytes(32).toString('hex')
    const tokenHash = sha256Hex(token)
    // 5 位数字空间共 10 万，实际并发极小；冲突重试 50 次足够
    for (let attempt = 0; attempt < 50; attempt++) {
      const name = generateGuestName()
      if (!this.store.findByName(name)) {
        const user = this.store.createUser(name, tokenHash)
        return { user, token }
      }
    }
    throw new Error('游客名生成失败：多次冲突')
  }

  /**
   * 解析身份：token 命中则复用既有账号；否则（无 token / 旧 token 失效）新建。
   * 返回 { identity }，identity.token 为当前有效的明文 token（客户端保存用）。
   */
  resolveIdentity(token?: string): { identity: GuestIdentity } {
    if (token) {
      const existing = this.findByToken(token)
      if (existing) {
        return { identity: { id: String(existing.id), name: existing.name, token } }
      }
    }
    const { user, token: freshToken } = this.createGuest()
    return { identity: { id: String(user.id), name: user.name, token: freshToken } }
  }
}
