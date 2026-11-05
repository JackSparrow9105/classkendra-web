import { RazorpaySuccess } from './services/public-pay.service';

/** The parts of Razorpay Checkout (checkout.razorpay.com/v1/checkout.js) the app uses. */
export interface RazorpayOptions {
  key: string;
  order_id: string;
  amount: number;
  currency: 'INR';
  name: string;
  description?: string;
  prefill?: { contact?: string; name?: string };
  theme?: { color?: string };
  handler: (res: RazorpaySuccess) => void;
  modal?: { ondismiss?: () => void };
}

interface RazorpayInstance {
  open(): void;
  on(event: 'payment.failed', cb: (res: { error: { description?: string } }) => void): void;
}

type RazorpayCtor = new (options: RazorpayOptions) => RazorpayInstance;

let loading: Promise<RazorpayCtor> | null = null;

/** Loads Razorpay Checkout once, the first time a parent taps Pay. */
export function loadRazorpay(): Promise<RazorpayCtor> {
  const existing = (window as unknown as { Razorpay?: RazorpayCtor }).Razorpay;
  if (existing) return Promise.resolve(existing);
  loading ??= new Promise<RazorpayCtor>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => {
      const ctor = (window as unknown as { Razorpay?: RazorpayCtor }).Razorpay;
      if (ctor) resolve(ctor);
      else reject(new Error('Payment could not start.'));
    };
    script.onerror = () => {
      loading = null;
      reject(new Error('Payment could not start. Check your internet and try again.'));
    };
    document.head.appendChild(script);
  });
  return loading;
}
