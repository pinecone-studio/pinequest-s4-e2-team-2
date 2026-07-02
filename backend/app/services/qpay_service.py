from __future__ import annotations

from typing import Any

import httpx

from app.config import get_settings


class QPayConfigurationError(RuntimeError):
    pass


class QPayAPIError(RuntimeError):
    pass


REQUEST_TIMEOUT_SECONDS = 20.0


def _join_url(base_url: str, path: str) -> str:
    return f"{base_url.rstrip('/')}/{path.lstrip('/')}"


def _short_response_text(response: httpx.Response) -> str:
    text = response.text.strip()
    if len(text) > 500:
        return f"{text[:500]}..."
    return text


class QuickPayClient:
    def __init__(self) -> None:
        settings = get_settings()
        if not settings.quickpay_api_url:
            raise QPayConfigurationError("QUICKPAY_API_URL is not configured.")
        if not settings.quickpay_api_key:
            raise QPayConfigurationError("QUICKPAY_API_KEY is not configured.")
        if not settings.quickpay_merchant_id:
            raise QPayConfigurationError("QUICKPAY_MERCHANT_ID is not configured.")

        self.base_url = settings.quickpay_api_url.rstrip("/")
        self.api_key = settings.quickpay_api_key
        self.merchant_id = settings.quickpay_merchant_id
        self.timeout = REQUEST_TIMEOUT_SECONDS

    def _request(
        self,
        method: str,
        path: str,
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
            "X-QPay-Merchant-Id": self.merchant_id,
        }

        url = _join_url(self.base_url, path)
        request_kwargs: dict[str, Any] = {"headers": headers}
        if payload is not None:
            request_kwargs["json"] = payload
        with httpx.Client(timeout=self.timeout) as client:
            response = client.request(method, url, **request_kwargs)

        if response.status_code >= 400:
            raise QPayAPIError(
                f"QuickPay {path} request failed ({response.status_code}): {_short_response_text(response)}"
            )

        if not response.text.strip():
            return {}

        try:
            data = response.json()
        except ValueError as exc:
            raise QPayAPIError(f"QuickPay {path} response was not valid JSON.") from exc

        if not isinstance(data, dict):
            raise QPayAPIError(f"QuickPay {path} response must be a JSON object.")

        success = data.get("success")
        if success is False:
            error = data.get("error") or data.get("message") or data
            raise QPayAPIError(f"QuickPay {path} failed: {error}")

        return data

    def create_invoice(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/qpay/invoices", payload)

    def check_invoice_payment(self, invoice_id: str, order_id: str | None = None) -> dict[str, Any]:
        payload = {
            "invoice_id": invoice_id,
            "object_id": invoice_id,
            "object_type": "INVOICE",
        }
        if order_id:
            payload["order_id"] = order_id
            payload["sender_invoice_no"] = order_id
        return self._request("POST", "/api/qpay/payments/check", payload)

    def get_invoice(self, invoice_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/qpay/invoices/{invoice_id}")


# Keep the old import name used by the payment service.
QPayClient = QuickPayClient
