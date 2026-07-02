from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class PaymentStatus(str, Enum):
    PENDING = "pending"
    PAID = "paid"
    FAILED = "failed"
    CANCELED = "canceled"
    EXPIRED = "expired"


class ContactInfo(BaseModel):
    id: str | None = Field(default=None, max_length=45)
    registration_number: str | None = Field(default=None, max_length=20)
    name: str | None = Field(default=None, max_length=100)
    email: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=20)
    address: dict[str, Any] | None = None


class OrderItem(BaseModel):
    code: str | None = Field(default=None, max_length=45)
    tax_product_code: str | None = Field(default=None, max_length=45)
    description: str = Field(min_length=1, max_length=255)
    quantity: float = Field(default=1.0, gt=0)
    unit_price: float = Field(gt=0)
    note: str | None = Field(default=None, max_length=255)
    metadata: dict[str, Any] = Field(default_factory=dict)


class PaymentOrderCreate(BaseModel):
    plan_id: str = Field(default="pro_monthly", min_length=1, max_length=80)
    amount: float | None = Field(default=None, gt=0)
    currency: str = Field(default="MNT", min_length=3, max_length=3)
    description: str | None = Field(default=None, max_length=255)
    contact: ContactInfo | None = None
    items: list[OrderItem] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class QPayBankUrl(BaseModel):
    name: str | None = None
    description: str | None = None
    link: str | None = None
    logo: str | None = None


class PaymentOrderRecord(BaseModel):
    id: str
    user_id: str
    provider: str = "quickpay"
    status: PaymentStatus = PaymentStatus.PENDING
    plan_id: str | None = None
    subscription_days: int | None = Field(default=None, gt=0)
    amount: float
    currency: str = "MNT"
    description: str
    contact: ContactInfo | None = None
    items: list[OrderItem] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    callback_url: str | None = None
    qpay_sender_invoice_no: str
    qpay_invoice_id: str | None = None
    qpay_payment_id: str | None = None
    qpay_payment_status: str | None = None
    qpay_paid_amount: float | None = None
    qpay_invoice_response: dict[str, Any] | None = None
    qpay_check_response: dict[str, Any] | None = None
    qr_text: str | None = None
    qr_image: str | None = None
    urls: list[QPayBankUrl] = Field(default_factory=list)
    failure_reason: str | None = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
    paid_at: datetime | None = None


class QPayCreatePaymentResponse(BaseModel):
    order: PaymentOrderRecord
    invoice_id: str | None = None
    qr_text: str | None = None
    qr_image: str | None = None
    urls: list[QPayBankUrl] = Field(default_factory=list)


class QPayPaymentStatusResponse(BaseModel):
    order: PaymentOrderRecord
    paid: bool = False


class QPayCallbackResponse(BaseModel):
    ok: bool = True
    order_id: str
    status: PaymentStatus
    paid: bool
