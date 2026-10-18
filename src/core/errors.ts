export class LudoscopeError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "LudoscopeError";
  }
}
export function ensure(
  condition: unknown,
  code: string,
  message: string,
): asserts condition {
  if (!condition) throw new LudoscopeError(code, message);
}
