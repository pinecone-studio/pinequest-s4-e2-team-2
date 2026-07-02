from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from app.config import get_settings
from app.models.payment import (
    PaymentOrderCreate,
    PaymentOrderRecord,
    PaymentStatus,
    QPayCallbackResponse,
    QPayCreatePaymentResponse,
    QPayPaymentStatusResponse,
)
from app.models.entities import UserProfile
from app.services import payment_service
from app.services.auth_service import get_current_user
from app.services.qpay_service import QPayAPIError, QPayConfigurationError


router = APIRouter(prefix="/payments", tags=["payments"])


def _service_error(exc: Exception) -> HTTPException:
    detail = "Payment service is temporarily unavailable."
    if get_settings().environment == "local":
        detail = f"{detail} {type(exc).__name__}: {exc}"
    return HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=detail)


def _bad_request(exc: Exception) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@router.post(
    "/quickpay/create",
    response_model=QPayCreatePaymentResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_qpay_payment(
    payload: PaymentOrderCreate | None = None,
    current_user: UserProfile = Depends(get_current_user),
) -> QPayCreatePaymentResponse:
    try:
        order = payment_service.create_qpay_order(current_user, payload)
    except payment_service.PaymentValidationError as exc:
        raise _bad_request(exc) from exc
    except (payment_service.PaymentConfigurationError, QPayConfigurationError, QPayAPIError) as exc:
        raise _service_error(exc) from exc

    return QPayCreatePaymentResponse(
        order=order,
        invoice_id=order.qpay_invoice_id,
        qr_text=order.qr_text,
        qr_image=order.qr_image,
        urls=order.urls,
    )


@router.get("/quickpay/status/{order_id}", response_model=QPayPaymentStatusResponse)
def get_qpay_payment_status(
    order_id: str,
    current_user: UserProfile = Depends(get_current_user),
) -> QPayPaymentStatusResponse:
    try:
        order = payment_service.get_order_for_user(order_id, current_user.id)
        if not order:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found.")
        order = payment_service.sync_order_status(order_id)
    except HTTPException:
        raise
    except (payment_service.PaymentValidationError, KeyError) as exc:
        raise _bad_request(exc) from exc
    except (payment_service.PaymentConfigurationError, QPayConfigurationError, QPayAPIError) as exc:
        raise _service_error(exc) from exc

    if order.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found.")
    return QPayPaymentStatusResponse(order=order, paid=order.status == PaymentStatus.PAID)


@router.get("/quickpay/orders/{order_id}", response_model=PaymentOrderRecord)
def get_qpay_order(
    order_id: str,
    current_user: UserProfile = Depends(get_current_user),
) -> PaymentOrderRecord:
    order = payment_service.get_order_for_user(order_id, current_user.id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found.")
    return order


async def _read_json_body(request: Request) -> dict[str, Any]:
    try:
        body = await request.json()
    except Exception:
        return {}
    return body if isinstance(body, dict) else {}


async def _handle_qpay_callback(
    request: Request,
    order_id: str | None,
    invoice_id: str | None,
) -> QPayCallbackResponse:
    try:
        body = await _read_json_body(request)
        resolved_order_id = payment_service.order_id_from_callback(body, order_id, invoice_id)
        order = payment_service.sync_order_status(resolved_order_id)
    except payment_service.PaymentValidationError as exc:
        raise _bad_request(exc) from exc
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found.") from exc
    except (payment_service.PaymentConfigurationError, QPayConfigurationError, QPayAPIError) as exc:
        raise _service_error(exc) from exc

    return QPayCallbackResponse(
        ok=True,
        order_id=order.id,
        status=order.status,
        paid=order.status == PaymentStatus.PAID,
    )


@router.post("/quickpay/callback", response_model=QPayCallbackResponse)
async def qpay_callback_post(
    request: Request,
    order_id: str | None = Query(default=None),
    invoice_id: str | None = Query(default=None),
) -> QPayCallbackResponse:
    return await _handle_qpay_callback(
        request,
        order_id=order_id,
        invoice_id=invoice_id,
    )


@router.get("/quickpay/callback", response_model=QPayCallbackResponse)
async def qpay_callback_get(
    request: Request,
    order_id: str | None = Query(default=None),
    invoice_id: str | None = Query(default=None),
) -> QPayCallbackResponse:
    return await _handle_qpay_callback(
        request,
        order_id=order_id,
        invoice_id=invoice_id,
    )
