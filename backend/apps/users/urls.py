from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from .views import (
    ChessTokenObtainPairView,
    GoogleAuthView,
    LogoutView,
    PasswordResetConfirmView,
    PasswordResetRequestView,
    RegisterView,
    CurrentUserView,
    ThemePreferenceView,
)

app_name = "users"

urlpatterns = [
    path("register/", RegisterView.as_view(), name="register"),
    path("login/", ChessTokenObtainPairView.as_view(), name="login"),
    path("google/", GoogleAuthView.as_view(), name="google-auth"),
    path(
        "password-reset/",
        PasswordResetRequestView.as_view(),
        name="password-reset-request",
    ),
    path(
        "password-reset/confirm/",
        PasswordResetConfirmView.as_view(),
        name="password-reset-confirm",
    ),
    path("me/", CurrentUserView.as_view(), name="current-user"),
    path("logout/", LogoutView.as_view(), name="logout"),
    path(
        "theme/",
        ThemePreferenceView.as_view(),
        name="theme-preference",
    ),
    path("token/refresh/", TokenRefreshView.as_view(), name="token-refresh"),
]
