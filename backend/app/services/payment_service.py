from __future__ import annotations

import re

from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from enum import Enum
from typing import Any
from urllib.parse import quote
from uuid import uuid4

from pydantic import BaseModel

from app.config import get_settings
from app.models.entities import SubscriptionStatus, UserPlan, UserProfile
from app.models.payment import (
    ContactInfo,
    OrderItem,
    PaymentOrderCreate,
    PaymentOrderRecord,
    PaymentStatus,
    QPayBankUrl,
)
from app.services import cache_service
from app.services.firebase_service import get_firestore_client
from app.services.qpay_service import QPayClient


PAYMENT_COLLECTION = "payment_orders"
SUBSCRIPTION_COLLECTION = "subscriptions"
PAYMENT_PLANS: dict[str, dict[str, Any]] = {
    "pro_monthly": {
        "id": "pro_monthly",
        "name": "Pro Monthly",
        "amount": 500,
        "currency": "MNT",
        "days": 30,
        "active": True,
    }
}


class PaymentConfigurationError(RuntimeError):
    pass


class PaymentValidationError(ValueError):
    pass


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _dump_model(model: BaseModel) -> dict[str, Any]:
    if hasattr(model, "model_dump"):
        data = model.model_dump(exclude_none=True)
    else:
        data = model.dict(exclude_none=True)
    return _firestore_value(data)


def _firestore_value(value: Any) -> Any:
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, dict):
        return {key: _firestore_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_firestore_value(item) for item in value]
    return value


def _doc_to_dict(snapshot: Any) -> dict[str, Any] | None:
    if not snapshot.exists:
        return None
    data = snapshot.to_dict() or {}
    data["id"] = snapshot.id
    return data


def _query_stream(query: Any, timeout: int = 10) -> Any:
    try:
        return query.stream(timeout=timeout)
    except TypeError:
        return query.stream()


def _money(value: Any) -> Decimal:
    try:
        return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except (InvalidOperation, TypeError) as exc:
        raise PaymentValidationError("Invalid money amount.") from exc


def _money_float(value: Any) -> float:
    return float(_money(value))


def _limit(value: str | None, length: int) -> str | None:
    if value is None:
        return None
    value = value.strip()
    if not value:
        return None
    return value[:length]


def _order_ref(order_id: str) -> Any:
    return get_firestore_client().collection(PAYMENT_COLLECTION).document(order_id)


def _build_callback_url(order_id: str) -> str | None:
    settings = get_settings()
    if not settings.public_backend_url:
        raise PaymentConfigurationError("PUBLIC_BACKEND_URL is required for QuickPay callbacks.")
    return f"{settings.public_backend_url.rstrip('/')}/payments/quickpay/callback?order_id={quote(order_id)}"


def _default_description(payload: PaymentOrderCreate, plan: dict[str, Any] | None = None) -> str:
    if plan and plan.get("name"):
        return str(plan["name"])
    return "SightAhead Pro monthly subscription"


def _get_payment_plan(plan_id: str) -> dict[str, Any] | None:
    plan = PAYMENT_PLANS.get(plan_id)
    if not plan:
        return None
    if plan.get("active") is not True:
        raise PaymentValidationError("Selected payment plan is not active.")
    return dict(plan)


def _normalize_items(
    payload: PaymentOrderCreate,
) -> tuple[list[OrderItem], float, str, int, str, str, dict[str, Any]]:
    if payload.amount is not None:
        raise PaymentValidationError("Payment amount must be read from the backend payment plan.")
    if payload.items:
        raise PaymentValidationError("Payment items must be derived from the backend payment plan.")

    plan = _get_payment_plan(payload.plan_id)
    if not plan:
        raise PaymentConfigurationError(f"Payment plan `{payload.plan_id}` is not configured.")

    amount = _money_float(plan.get("amount"))
    if amount <= 0:
        raise PaymentValidationError("Payment plan amount must be greater than zero.")

    try:
        days = int(plan.get("days"))
    except (TypeError, ValueError) as exc:
        raise PaymentValidationError("Payment plan days must be configured in the backend.") from exc
    if days <= 0:
        raise PaymentValidationError("Payment plan days must be greater than zero.")

    currency = str(plan.get("currency") or "MNT").upper()
    if currency != "MNT":
        raise PaymentValidationError("QuickPay payment plans must use MNT currency.")

    description = _default_description(payload, plan)
    item = OrderItem(
        code=payload.plan_id,
        description=description,
        quantity=1,
        unit_price=amount,
        metadata={"plan_id": payload.plan_id},
    )
    metadata = {
        "plan_id": payload.plan_id,
        "plan_name": plan.get("name"),
        "plan_currency": currency,
    }
    return [item], amount, description, days, payload.plan_id, currency, metadata


def _normalize_contact(payload: PaymentOrderCreate, user: UserProfile) -> ContactInfo:
    contact = payload.contact or ContactInfo()
    return ContactInfo(
        id=_limit(contact.id or user.id, 45),
        registration_number=_limit(contact.registration_number, 20),
        name=_limit(contact.name or user.display_name, 100),
        email=_limit(contact.email or user.email, 255),
        phone=_limit(contact.phone, 20),
        address=contact.address,
    )


def _qpay_receiver_code(order: PaymentOrderRecord) -> str:
    contact = order.contact or ContactInfo()
    value = contact.registration_number or contact.id or contact.email or order.user_id
    value = _limit(value, 45)
    if not value:
        raise PaymentValidationError("QPay invoice_receiver_code could not be derived.")
    return value


def _qpay_receiver_data(contact: ContactInfo | None) -> dict[str, Any] | None:
    if not contact:
        return None
    data = {
        "register": contact.registration_number,
        "name": contact.name,
        "email": contact.email,
        "phone": contact.phone,
        "address": contact.address,
    }
    return {key: value for key, value in data.items() if value is not None} or None


def _quickpay_items(order: PaymentOrderRecord) -> list[dict[str, Any]]:
    lines: list[dict[str, Any]] = []
    for item in order.items:
        line = {
            "code": item.code,
            "tax_product_code": item.tax_product_code,
            "description": item.description,
            "quantity": _money_float(item.quantity),
            "unit_price": _money_float(item.unit_price),
            "amount": _money_float(_money(item.quantity) * _money(item.unit_price)),
            "note": item.note or "",
            "metadata": item.metadata,
        }
        lines.append({key: value for key, value in line.items() if value is not None})
    return lines


def _build_qpay_invoice_payload(order: PaymentOrderRecord) -> dict[str, Any]:
    settings = get_settings()
    required = {
        "QUICKPAY_MERCHANT_ID": settings.quickpay_merchant_id,
        "QUICKPAY_MCC_CODE": settings.quickpay_mcc_code,
        "QUICKPAY_BANK_CODE": settings.quickpay_bank_code,
        "QUICKPAY_ACCOUNT_NUMBER": settings.quickpay_account_number,
        "QUICKPAY_ACCOUNT_NAME": settings.quickpay_account_name,
    }
    missing = [key for key, value in required.items() if not value]
    if missing:
        raise PaymentConfigurationError(f"Missing QuickPay configuration: {', '.join(missing)}")
    if not order.callback_url:
        raise PaymentConfigurationError("PUBLIC_BACKEND_URL is required for QuickPay callback_url.")

    return {
        "merchant_id": settings.quickpay_merchant_id,
        "amount": _money_float(order.amount),
        "currency": "MNT",
        "mcc_code": settings.quickpay_mcc_code,
        "description": _limit(order.description, 255),
        "bank_accounts": [
            {
                "account_bank_code": settings.quickpay_bank_code,
                "account_number": settings.quickpay_account_number,
                "account_name": settings.quickpay_account_name,
                "is_default": True,
            }
        ],
        "callback_url": order.callback_url,
    }


def _invoice_id_from_qpay_response(invoice_response: dict[str, Any], fallback: str) -> str:
    return str(
        _first_value(
            invoice_response,
            "invoice_id",
            "invoiceId",
            "qpay_invoice_id",
            "qpayInvoiceId",
            "object_id",
            "objectId",
            "invoice_no",
            "invoiceNo",
            "id",
            "payment_id",
            "transaction_id",
            "order_id",
        )
        or fallback
    )


def _unwrap_quickpay_response(data: dict[str, Any]) -> dict[str, Any]:
    nested = data.get("data")
    if isinstance(nested, dict):
        return nested
    result = data.get("result")
    if isinstance(result, dict):
        return result
    invoice = data.get("invoice")
    if isinstance(invoice, dict):
        return invoice
    payment = data.get("payment")
    if isinstance(payment, dict):
        return payment
    return data


def _first_value(data: dict[str, Any], *keys: str) -> Any:
    nested = _unwrap_quickpay_response(data)
    for source in (nested, data):
        for key in keys:
            value = source.get(key)
            if value is not None:
                return value
    return None


def _urls_from_qpay(data: dict[str, Any]) -> list[QPayBankUrl]:
    nested = _unwrap_quickpay_response(data)
    urls = (
        nested.get("urls")
        or nested.get("deeplinks")
        or nested.get("bank_urls")
        or nested.get("bankUrls")
        or data.get("urls")
        or data.get("deeplinks")
        or data.get("bank_urls")
        or data.get("bankUrls")
        or []
    )
    if isinstance(urls, dict):
        urls = list(urls.values())
    if not isinstance(urls, list):
        return []
    parsed: list[QPayBankUrl] = []
    for item in urls:
        if isinstance(item, dict):
            link = _first_navigable_bank_url(
                item,
                "deeplink",
                "deep_link",
                "app_link",
                "appLink",
                "universal_link",
                "universalLink",
                "web_url",
                "webUrl",
                "bank_url",
                "bankUrl",
                "bank_link",
                "bankLink",
                "payment_url",
                "paymentUrl",
                "payment_link",
                "paymentLink",
                "checkout_url",
                "checkoutUrl",
                "url",
                "link",
            )
            if not link:
                continue
            parsed.append(
                QPayBankUrl(
                    name=_first_bank_url_value(item, "name", "bank_name", "bankName"),
                    description=_first_bank_url_value(item, "description", "title", "label"),
                    link=link,
                    logo=_first_bank_url_value(item, "logo", "logo_url", "logoUrl", "icon"),
                )
            )
        elif isinstance(item, str) and _is_bank_navigation_link(item):
            parsed.append(QPayBankUrl(link=item.strip()))
    return parsed


def _is_bank_navigation_link(value: str) -> bool:
    value = value.strip()
    if not value:
        return False
    # Raw EMV QR payloads start with numeric data such as "000201..."; those are
    # scannable QR text, not browser/app navigation URLs.
    if value.startswith("000201"):
        return False
    return bool(re.match(r"^[A-Za-z][A-Za-z0-9+.-]*:", value))


def _first_navigable_bank_url(data: dict[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = data.get(key)
        if isinstance(value, str) and _is_bank_navigation_link(value):
            return value.strip()
    ignored_keys = {
        "name",
        "bank_name",
        "bankName",
        "description",
        "title",
        "label",
        "logo",
        "logo_url",
        "logoUrl",
        "icon",
        "image",
        "qr",
        "qr_text",
        "qrText",
        "qr_image",
        "qrImage",
    }
    for key, value in data.items():
        if key in ignored_keys:
            continue
        if isinstance(value, str) and _is_bank_navigation_link(value):
            return value.strip()
    return None


def _first_bank_url_value(data: dict[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _paid_row(check_response: dict[str, Any]) -> dict[str, Any] | None:
    for row in _payment_row_candidates(check_response):
        status_value = _first_payment_value(row, *_PAYMENT_STATUS_KEYS)
        if _is_paid_status(status_value):
            if str(status_value).strip().upper() != "PAID" and not _has_payment_context(row):
                continue
            paid = dict(row)
            paid["payment_status"] = str(status_value).upper()
            return paid
    return None


_PAYMENT_STATUS_KEYS = (
    "payment_status",
    "paymentStatus",
    "status",
    "state",
    "payment_state",
    "paymentState",
    "transaction_status",
    "transactionStatus",
)

_PAYMENT_AMOUNT_KEYS = (
    "paid_amount",
    "paidAmount",
    "payment_amount",
    "paymentAmount",
    "amount",
    "total_amount",
    "totalAmount",
)

_PAYMENT_ID_KEYS = (
    "payment_id",
    "paymentId",
    "transaction_id",
    "transactionId",
    "id",
)

_PAYMENT_DATE_KEYS = (
    "payment_date",
    "paymentDate",
    "paid_at",
    "paidAt",
    "transaction_date",
    "transactionDate",
    "created_at",
    "createdAt",
)

_PAID_STATUSES = {"PAID", "SUCCESS", "SUCCEEDED", "COMPLETED", "APPROVED", "SETTLED"}


def _is_paid_status(value: Any) -> bool:
    return isinstance(value, str) and value.strip().upper() in _PAID_STATUSES


def _truthy_paid_value(value: Any) -> bool:
    if value is True:
        return True
    if isinstance(value, str):
        return value.strip().lower() in {"true", "paid", "success", "succeeded", "completed", "approved"}
    return False


def _first_payment_value(data: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = data.get(key)
        if value is not None:
            return value
    return None


def _has_payment_context(data: dict[str, Any]) -> bool:
    for key in (*_PAYMENT_AMOUNT_KEYS, *_PAYMENT_ID_KEYS, *_PAYMENT_DATE_KEYS):
        if data.get(key) is not None:
            return True
    return False


def _payment_row_candidates(value: Any, depth: int = 0) -> list[dict[str, Any]]:
    if depth > 4:
        return []
    if isinstance(value, list):
        rows: list[dict[str, Any]] = []
        for item in value:
            rows.extend(_payment_row_candidates(item, depth + 1))
        return rows
    if not isinstance(value, dict):
        return []

    rows = [value]
    for key in (
        "data",
        "result",
        "payment",
        "payments",
        "transaction",
        "transactions",
        "rows",
        "items",
        "list",
        "results",
    ):
        nested = value.get(key)
        if isinstance(nested, (dict, list)):
            rows.extend(_payment_row_candidates(nested, depth + 1))
    return rows


def _first_money_value(*values: Any) -> Decimal | None:
    for value in values:
        if value is None:
            continue
        try:
            return _money(value)
        except PaymentValidationError:
            continue
    return None


def _paid_amount_from_response(check_response: dict[str, Any], row: dict[str, Any] | None = None) -> Decimal | None:
    nested = _unwrap_quickpay_response(check_response)
    row = row or {}
    return _first_money_value(
        _first_payment_value(row, *_PAYMENT_AMOUNT_KEYS),
        _first_payment_value(nested, *_PAYMENT_AMOUNT_KEYS),
        _first_payment_value(check_response, *_PAYMENT_AMOUNT_KEYS),
    )


def _parse_payment_date(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


def _is_paid(check_response: dict[str, Any], expected_amount: float) -> bool:
    nested = _unwrap_quickpay_response(check_response)
    paid_value = nested.get("paid") or check_response.get("paid")
    row = _paid_row(check_response) or {}
    paid_amount = _paid_amount_from_response(check_response, row)

    if _truthy_paid_value(paid_value):
        if paid_amount is None:
            return True
        return paid_amount >= _money(expected_amount)

    if row:
        if paid_amount is None:
            return True
        return paid_amount >= _money(expected_amount)

    count_value = nested.get("count") or nested.get("payment_count") or nested.get("paymentCount")
    try:
        has_payment_rows = int(count_value or 0) > 0
    except (TypeError, ValueError):
        has_payment_rows = False
    return bool(has_payment_rows and paid_amount is not None and paid_amount >= _money(expected_amount))


def _status_from_doc(data: dict[str, Any]) -> PaymentOrderRecord:
    return PaymentOrderRecord(**data)


def get_order(order_id: str) -> PaymentOrderRecord | None:
    data = _doc_to_dict(_order_ref(order_id).get())
    return _status_from_doc(data) if data else None


def get_order_for_user(order_id: str, user_id: str) -> PaymentOrderRecord | None:
    order = get_order(order_id)
    if not order or order.user_id != user_id:
        return None
    return order


def find_order_by_invoice_id(invoice_id: str) -> PaymentOrderRecord | None:
    query = (
        get_firestore_client()
        .collection(PAYMENT_COLLECTION)
        .where("qpay_invoice_id", "==", invoice_id)
        .limit(1)
    )
    for doc in _query_stream(query):
        data = doc.to_dict() or {}
        data.setdefault("id", doc.id)
        return _status_from_doc(data)
    return None


def create_qpay_order(user: UserProfile, payload: PaymentOrderCreate | None = None) -> PaymentOrderRecord:
    payload = payload or PaymentOrderCreate()
    if user.is_guest:
        raise PaymentValidationError("Firebase user account is required before payment.")

    items, amount, description, subscription_days, plan_id, currency, metadata = _normalize_items(payload)
    contact = _normalize_contact(payload, user)
    order_id = uuid4().hex
    now = utc_now()
    order = PaymentOrderRecord(
        id=order_id,
        user_id=user.id,
        plan_id=plan_id,
        subscription_days=subscription_days,
        amount=amount,
        currency=currency,
        description=description,
        contact=contact,
        items=items,
        metadata=metadata,
        callback_url=_build_callback_url(order_id),
        qpay_sender_invoice_no=order_id,
        created_at=now,
        updated_at=now,
    )

    ref = _order_ref(order_id)
    ref.set(_dump_model(order))

    try:
        invoice_response = QPayClient().create_invoice(_build_qpay_invoice_payload(order))
    except Exception as exc:
        ref.set(
            {
                "status": PaymentStatus.FAILED.value,
                "failure_reason": str(exc),
                "updated_at": utc_now(),
            },
            merge=True,
        )
        raise

    updates = {
        "qpay_invoice_id": _invoice_id_from_qpay_response(invoice_response, order.id),
        "qpay_invoice_response": invoice_response,
        "qr_text": _first_value(invoice_response, "qr_text", "qrText", "qr", "qr_data"),
        "qr_image": _first_value(invoice_response, "qr_image", "qrImage", "qr_code", "qrCode"),
        "urls": [_dump_model(url) for url in _urls_from_qpay(invoice_response)],
        "updated_at": utc_now(),
    }
    ref.set({key: value for key, value in updates.items() if value is not None}, merge=True)
    return get_order(order_id) or order


def _activate_pro_subscription(order: PaymentOrderRecord, paid_at: datetime | None) -> None:
    if not order.subscription_days or order.subscription_days <= 0:
        raise PaymentConfigurationError("Payment order is missing subscription_days from Firestore plan.")

    now = utc_now()
    starts_at = now
    try:
        profile = cache_service.get_user_profile(order.user_id)
        if profile.subscription_current_period_end and profile.subscription_current_period_end > now:
            starts_at = profile.subscription_current_period_end
    except Exception:
        starts_at = now

    ends_at = starts_at + timedelta(days=order.subscription_days)
    cache_service.set_user_subscription(
        order.user_id,
        plan=UserPlan.PRO,
        subscription_status=SubscriptionStatus.ACTIVE,
        subscription_provider="quickpay",
        subscription_current_period_end=ends_at,
    )
    subscription_ref = get_firestore_client().collection(SUBSCRIPTION_COLLECTION).document(order.user_id)
    subscription_updates = {
        "id": order.user_id,
        "user_id": order.user_id,
        "provider": "quickpay",
        "provider_order_id": order.id,
        "provider_invoice_id": order.qpay_invoice_id,
        "provider_payment_id": order.qpay_payment_id,
        "status": SubscriptionStatus.ACTIVE.value,
        "current_period_start": starts_at,
        "current_period_end": ends_at,
        "last_paid_at": paid_at or now,
        "updated_at": now,
    }
    if not subscription_ref.get().exists:
        subscription_updates["created_at"] = now
    subscription_ref.set(subscription_updates, merge=True)


def mark_order_paid(order: PaymentOrderRecord, check_response: dict[str, Any]) -> PaymentOrderRecord:
    current = get_order(order.id)
    if not current:
        raise KeyError("Order not found.")
    if current.status == PaymentStatus.PAID:
        return current

    row = _paid_row(check_response) or {}
    nested = _unwrap_quickpay_response(check_response)
    paid_at = (
        _parse_payment_date(_first_payment_value(row, *_PAYMENT_DATE_KEYS))
        or _parse_payment_date(_first_payment_value(nested, *_PAYMENT_DATE_KEYS))
        or utc_now()
    )
    payment_amount = float(_paid_amount_from_response(check_response, row) or _money(current.amount))
    payment_id = _first_payment_value(row, *_PAYMENT_ID_KEYS) or _first_payment_value(nested, *_PAYMENT_ID_KEYS)
    payment_status = _first_payment_value(row, *_PAYMENT_STATUS_KEYS) or _first_payment_value(nested, *_PAYMENT_STATUS_KEYS)
    updates = {
        "status": PaymentStatus.PAID.value,
        "qpay_payment_id": str(payment_id) if payment_id is not None else None,
        "qpay_payment_status": str(payment_status) if payment_status is not None else None,
        "qpay_paid_amount": payment_amount,
        "qpay_check_response": check_response,
        "paid_at": paid_at,
        "updated_at": utc_now(),
    }
    _order_ref(current.id).set({key: value for key, value in updates.items() if value is not None}, merge=True)
    paid_order = get_order(current.id) or current
    _activate_pro_subscription(paid_order, paid_at)
    return get_order(current.id) or paid_order


def sync_order_status(order_id: str) -> PaymentOrderRecord:
    order = get_order(order_id)
    if not order:
        raise KeyError("Order not found.")
    if order.status == PaymentStatus.PAID:
        return order
    if not order.qpay_invoice_id:
        return order

    invoice_id = order.qpay_invoice_id
    if order.qpay_invoice_response:
        invoice_id = _invoice_id_from_qpay_response(order.qpay_invoice_response, invoice_id)
        if invoice_id != order.qpay_invoice_id:
            _order_ref(order.id).set(
                {
                    "qpay_invoice_id": invoice_id,
                    "updated_at": utc_now(),
                },
                merge=True,
            )

    check_response = QPayClient().check_invoice_payment(invoice_id, order.id)
    updates = {
        "qpay_check_response": check_response,
        "updated_at": utc_now(),
    }
    _order_ref(order.id).set(updates, merge=True)

    if _is_paid(check_response, order.amount):
        return mark_order_paid(order, check_response)
    return get_order(order.id) or order


def order_id_from_callback(body: dict[str, Any] | None, order_id: str | None, invoice_id: str | None) -> str:
    body = body or {}
    sources = [body]
    for key in ("data", "result", "invoice", "payment"):
        value = body.get(key)
        if isinstance(value, dict):
            sources.append(value)

    def first_callback_value(*keys: str) -> Any:
        for source in sources:
            for key in keys:
                value = source.get(key)
                if value is not None:
                    return value
        return None

    derived_order_id = order_id or first_callback_value("order_id", "sender_invoice_no")
    if derived_order_id:
        return str(derived_order_id)

    derived_invoice_id = invoice_id or first_callback_value("invoice_id", "invoiceId", "object_id")
    if derived_invoice_id:
        order = find_order_by_invoice_id(str(derived_invoice_id))
        if order:
            return order.id

    raise PaymentValidationError("QuickPay callback did not include order_id or invoice_id.")
