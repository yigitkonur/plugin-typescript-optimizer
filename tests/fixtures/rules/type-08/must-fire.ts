export enum Status { Active = 'active', Inactive = 'inactive' }
export const enum Dir { Up, Down }
namespace Legacy {
  export const version = 1;
}
export class UserService {
  constructor(private readonly repo: Repo, public name: string) {}
}
export class Plain {
  constructor(a: string, protected b: number) {}
}
interface Repo { id: string }
