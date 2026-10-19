interface UserSettings extends Record<string, any> {
  theme: 'dark' | 'light';
}
interface Mixed extends Base, Record<PropertyKey, any> { n: number }
interface Base { id: string }
interface PrimaryButtonProps extends ButtonBaseProps {}
type StringId = string;
export type Username = string;
export type ApiRequestConfig = AxiosRequestOptions;
type AsyncRequest = {
  status: 'idle' | 'loading' | 'success' | 'error';
  data?: Record<string, unknown>;
  error?: Error;
  startedAt?: number;
};
declare const ButtonBaseProps: unknown;
