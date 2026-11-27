export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NEXT_PHASE !== 'phase-production-build') {
    const { deliverProductMail } = await import('./lib/product-access-mail');
    const timer = setInterval(() => {
      deliverProductMail().catch(() => console.error('Could not process pending product access mail.'));
    }, 60000);
    timer.unref();
  }
}
