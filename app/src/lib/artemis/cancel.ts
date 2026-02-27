export class CancelToken {
  private _token = 0;

  next(): number {
    this._token += 1;
    return this._token;
  }

  current(): number {
    return this._token;
  }

  guard(localToken: number) {
    if (localToken !== this._token) throw new Error("Cancelled");
  }
}