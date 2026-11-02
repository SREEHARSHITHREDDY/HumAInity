export class AppError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}
export const badRequest = (m: string, c?: string) => new AppError(400, m, c);
export const unauthorized = (m = 'Not authenticated') => new AppError(401, m);
export const forbidden = (m = 'Not permitted') => new AppError(403, m, 'FORBIDDEN');
export const notFound = (m = 'Not found') => new AppError(404, m);
export const conflict = (m: string) => new AppError(409, m);
export const unprocessable = (m: string, c?: string) => new AppError(422, m, c);
