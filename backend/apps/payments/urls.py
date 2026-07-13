from django.urls import path

from .views import (
    CheckoutSessionView,
    MySubscriptionView,
    StripeReturnView,
    StripeWebhookView,
)

app_name = "payments"

urlpatterns = [
    path("stripe/checkout/", CheckoutSessionView.as_view(), name="stripe-checkout"),
    path("stripe/webhook/", StripeWebhookView.as_view(), name="stripe-webhook"),
    path("stripe/return/", StripeReturnView.as_view(), name="stripe-return"),
    path("subscription/", MySubscriptionView.as_view(), name="subscription"),
]
