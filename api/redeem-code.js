import {
  createAdminClient,
  getUserFromRequest,
} from "../lib/points.js";

const REDEEM_ERROR_MESSAGES = {
  INVALID_USER: "登录状态无效，请重新登录。",
  EMPTY_CODE: "请输入兑换码。",
  INVALID_CODE: "兑换码无效，请检查后重试。",
  INACTIVE_CODE: "该兑换码已失效。",
  EXPIRED_CODE: "该兑换码已过期。",
  CODE_LIMIT_REACHED: "该兑换码的可用次数已用完。",
  CODE_ALREADY_REDEEMED: "你已经使用过这个兑换码。",
  PROFILE_NOT_FOUND: "未找到当前账户资料。",
};

function getRedeemErrorMessage(error) {
  const errorText = String(error?.message || "");
  const matchedCode = Object.keys(REDEEM_ERROR_MESSAGES).find((code) =>
    errorText.includes(code)
  );

  return matchedCode
    ? REDEEM_ERROR_MESSAGES[matchedCode]
    : "兑换失败，请稍后重试。";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const supabaseAdmin = createAdminClient();
    const user = await getUserFromRequest(supabaseAdmin, req);

    if (!user) {
      return res.status(401).json({ error: "请先登录再使用兑换码。" });
    }

    const code = String(req.body?.code || "").trim().toUpperCase();
    if (!code) {
      return res.status(400).json({ error: "请输入兑换码。" });
    }

    const { data, error } = await supabaseAdmin.rpc(
      "redeem_code_for_user",
      {
        target_user_id: user.id,
        raw_code: code,
      }
    );

    if (error) {
      return res.status(400).json({ error: getRedeemErrorMessage(error) });
    }

    const rewardType = data?.rewardType === "pro" ? "pro" : "credits";
    const message =
      rewardType === "pro"
        ? `兑换成功，已获得 ${Number(data?.proDays || 0)} 天 Pro 和 ${Number(
            data?.creditsAdded || 0
          )} 永久 Credits。`
        : `兑换成功，已获得 ${Number(data?.creditsAdded || 0)} 永久 Credits。`;

    return res.status(200).json({ ...data, message });
  } catch (error) {
    console.error("Redeem code error:", error);
    return res.status(500).json({ error: "兑换失败，请稍后重试。" });
  }
}
