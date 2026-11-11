export function cronResultStatus(result: { success?: boolean }) {
  return result.success === true ? 200 : 409;
}
