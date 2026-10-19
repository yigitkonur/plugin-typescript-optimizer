// One implementer: a hypothetical seam (Seam Test: one adapter is not a seam).
export interface IUserService {
  getUser(id: string): Promise<string>;
}
export class UserService implements IUserService {
  async getUser(id: string) { return id; }
}

// No implementer at all, generic, with a default.
export interface IPaymentGateway<T = unknown> {
  charge(amount: number): Promise<T>;
}

export interface IRepository extends Base {
  find(id: string): unknown;
}
export default interface IConfigSource { read(): string }
