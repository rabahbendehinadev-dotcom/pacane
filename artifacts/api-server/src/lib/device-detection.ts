import crypto from "crypto";

export interface DeviceInfo {
  deviceType: "mobile" | "desktop";
  os: string;
  osVersion: string;
  browser: string;
  browserVersion: string;
  deviceName: string;
}

export function parseUserAgent(ua: string): DeviceInfo {
  const s = ua ?? "";

  const isMobile = /Mobile|Android|iPhone|iPad|iPod|BlackBerry|Windows Phone|Opera Mini|IEMobile/i.test(s);

  let os = "Unknown";
  let osVersion = "";
  if (/Windows NT 10\.0/.test(s)) { os = "Windows"; osVersion = "10/11"; }
  else if (/Windows NT 6\.3/.test(s)) { os = "Windows"; osVersion = "8.1"; }
  else if (/Windows NT 6\.1/.test(s)) { os = "Windows"; osVersion = "7"; }
  else if (/Windows/.test(s)) { os = "Windows"; osVersion = ""; }
  else if (/Mac OS X ([\d_]+)/.test(s)) { os = "macOS"; osVersion = s.match(/Mac OS X ([\d_]+)/)?.[1]?.replace(/_/g, ".") ?? ""; }
  else if (/Android ([\d.]+)/.test(s)) { os = "Android"; osVersion = s.match(/Android ([\d.]+)/)?.[1] ?? ""; }
  else if (/iPhone OS ([\d_]+)/.test(s)) { os = "iOS"; osVersion = s.match(/iPhone OS ([\d_]+)/)?.[1]?.replace(/_/g, ".") ?? ""; }
  else if (/iPad.*OS ([\d_]+)/.test(s)) { os = "iPadOS"; osVersion = s.match(/OS ([\d_]+)/)?.[1]?.replace(/_/g, ".") ?? ""; }
  else if (/Linux/.test(s)) { os = "Linux"; }
  else if (/CrOS/.test(s)) { os = "ChromeOS"; }

  let browser = "Unknown";
  let browserVersion = "";
  if (/Edg\/([\d.]+)/.test(s)) { browser = "Edge"; browserVersion = s.match(/Edg\/([\d.]+)/)?.[1] ?? ""; }
  else if (/OPR\/([\d.]+)|Opera\/([\d.]+)/.test(s)) { browser = "Opera"; browserVersion = s.match(/OPR\/([\d.]+)/)?.[1] ?? s.match(/Opera\/([\d.]+)/)?.[1] ?? ""; }
  else if (/Chrome\/([\d.]+)/.test(s) && !/Chromium/.test(s)) { browser = "Chrome"; browserVersion = s.match(/Chrome\/([\d.]+)/)?.[1]?.split(".")[0] ?? ""; }
  else if (/Firefox\/([\d.]+)/.test(s)) { browser = "Firefox"; browserVersion = s.match(/Firefox\/([\d.]+)/)?.[1]?.split(".")[0] ?? ""; }
  else if (/Safari\/([\d.]+)/.test(s) && !/Chrome/.test(s)) { browser = "Safari"; browserVersion = s.match(/Version\/([\d.]+)/)?.[1]?.split(".")[0] ?? ""; }
  else if (/Chromium\/([\d.]+)/.test(s)) { browser = "Chromium"; browserVersion = s.match(/Chromium\/([\d.]+)/)?.[1]?.split(".")[0] ?? ""; }

  const deviceName = `${browser}${browserVersion ? " " + browserVersion : ""} — ${os}${osVersion ? " " + osVersion : ""}`;

  return { deviceType: isMobile ? "mobile" : "desktop", os, osVersion, browser, browserVersion, deviceName };
}

export function fingerprintUA(ua: string): string {
  return crypto.createHash("sha256").update(ua ?? "").digest("hex").slice(0, 32);
}
