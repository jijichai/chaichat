import { buildApp } from './app';

export { TxQueue } from './txqueue';

export default {
  fetch(request, env, ctx) {
    return buildApp(env).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
