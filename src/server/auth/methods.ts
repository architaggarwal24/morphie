import { emailLoginEnabled } from "../email";
import { oauthProviderEnabled } from "./oauth";

/** Which sign-in methods this server offers right now (drives the sign-in dialog). */
export function loginMethods(): { email: boolean; google: boolean; github: boolean } {
  return { email: emailLoginEnabled(), google: oauthProviderEnabled("google"), github: oauthProviderEnabled("github") };
}
