from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from .views import (
    ChessTokenObtainPairView,
    GoogleLoginView,
    MeView,
    PasswordResetVerifyCodeView,
    PasswordResetConfirmView,
    PasswordResetRequestView,
    RegisterView,
)

app_name = "users"

urlpatterns = [
    path("register/", RegisterView.as_view(), name="register"),
    path("login/", ChessTokenObtainPairView.as_view(), name="login"),
    path("token/refresh/", TokenRefreshView.as_view(), name="token-refresh"),
    path("password-reset/", PasswordResetRequestView.as_view(), name="password-reset"),
    path(
        "password-reset/verify-code/",
        PasswordResetVerifyCodeView.as_view(),
        name="password-reset-verify-code",
    ),
    path(
        "password-reset/confirm/",
        PasswordResetConfirmView.as_view(),
        name="password-reset-confirm",
    ),
    path("me/", MeView.as_view(), name="me"),
    path("google/", GoogleLoginView.as_view(), name="google-login"),
]
