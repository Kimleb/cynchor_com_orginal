import { enroll, staffEmail } from '../src/lib/zipi-factors';

const email = staffEmail.safeParse(process.argv[2] || process.env.OPERATOR_EMAIL);
if (!email.success || !process.stdout.isTTY) {
  console.error('In a private terminal, run npm run create-operator -- your-address@cynchor.com');
  process.exit(1);
}
async function createOperator(address: string) {
  try {
    const secret = await enroll(address);
    console.log('In Google Authenticator choose Enter a setup key. Select Time based.');
    console.log('Account:', email.data);
    console.log('Setup key (keep private):', secret);
  } catch {
    console.error('Enrollment failed. Check your local configuration and whether this operator is already enrolled.');
    process.exitCode = 1;
  }
}

void createOperator(email.data);
