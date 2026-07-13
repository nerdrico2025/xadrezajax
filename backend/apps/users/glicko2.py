"""
Implementação do sistema de rating Glicko-2 de Mark Glickman.

Referência: Glickman, M. E., "Example of the Glicko-2 system",
http://www.glicko.net/glicko/glicko2.pdf — a implementação segue o passo a
passo do paper (steps 1–8) e é validada nos testes contra o exemplo numérico
oficial (r=1500, RD=200 vs 3 oponentes → r'≈1464.06, RD'≈151.52).

Decisão registrada no PLANO_FASE0 §0.3: módulo interno em vez da lib PyPI
`glicko2` (sem manutenção há anos, transcrição direta do paper sem testes).

Cada partida é tratada como um "período de avaliação" de um jogo só —
aproximação padrão em servidores online (ex.: Lichess), que mantém o rating
atualizado em tempo real em vez de acumular partidas por período.
"""

import math
from dataclasses import dataclass

# Constante de sistema (tau): limita o quanto a volatilidade pode variar por
# período. O paper recomenda entre 0.3 e 1.2; valores menores = mais estável.
TAU = 0.5
EPSILON = 1e-6

# Fator de conversão entre a escala Glicko (exibida) e a interna do Glicko-2
GLICKO2_SCALE = 173.7178

DEFAULT_RATING = 1500.0
DEFAULT_DEVIATION = 350.0
DEFAULT_VOLATILITY = 0.06

WIN = 1.0
DRAW = 0.5
LOSS = 0.0


@dataclass(frozen=True)
class Rating:
    rating: float = DEFAULT_RATING
    deviation: float = DEFAULT_DEVIATION
    volatility: float = DEFAULT_VOLATILITY


def _g(phi):
    return 1.0 / math.sqrt(1.0 + 3.0 * phi**2 / math.pi**2)


def _expected(mu, mu_j, phi_j):
    return 1.0 / (1.0 + math.exp(-_g(phi_j) * (mu - mu_j)))


def _new_volatility(phi, v, delta, sigma):
    """Step 5 do paper — iteração de Illinois para a nova volatilidade."""
    a = math.log(sigma**2)

    def f(x):
        ex = math.exp(x)
        num = ex * (delta**2 - phi**2 - v - ex)
        den = 2.0 * (phi**2 + v + ex) ** 2
        return num / den - (x - a) / TAU**2

    big_a = a
    if delta**2 > phi**2 + v:
        big_b = math.log(delta**2 - phi**2 - v)
    else:
        k = 1
        while f(a - k * TAU) < 0:
            k += 1
        big_b = a - k * TAU

    f_a, f_b = f(big_a), f(big_b)
    while abs(big_b - big_a) > EPSILON:
        big_c = big_a + (big_a - big_b) * f_a / (f_b - f_a)
        f_c = f(big_c)
        if f_c * f_b <= 0:
            big_a, f_a = big_b, f_b
        else:
            f_a /= 2.0
        big_b, f_b = big_c, f_c

    return math.exp(big_a / 2.0)


def rate(player, outcomes):
    """
    Calcula o novo rating de `player` após um período de avaliação.

    `outcomes`: lista de tuplas (oponente: Rating, score: float), com score
    1.0 (vitória), 0.5 (empate) ou 0.0 (derrota) do ponto de vista do player.

    Retorna um novo `Rating` (o objeto original não é modificado).
    """
    if not outcomes:
        return player

    # Steps 1–2: converte para a escala interna do Glicko-2
    mu = (player.rating - DEFAULT_RATING) / GLICKO2_SCALE
    phi = player.deviation / GLICKO2_SCALE

    # Step 3: variância estimada com base apenas nos resultados do período
    v_inv = 0.0
    delta_sum = 0.0
    for opponent, score in outcomes:
        mu_j = (opponent.rating - DEFAULT_RATING) / GLICKO2_SCALE
        phi_j = opponent.deviation / GLICKO2_SCALE
        g_j = _g(phi_j)
        e_j = _expected(mu, mu_j, phi_j)
        v_inv += g_j**2 * e_j * (1.0 - e_j)
        delta_sum += g_j * (score - e_j)
    v = 1.0 / v_inv

    # Step 4: melhoria estimada do rating
    delta = v * delta_sum

    # Step 5: nova volatilidade
    sigma_new = _new_volatility(phi, v, delta, player.volatility)

    # Steps 6–7: novos deviation e rating
    phi_star = math.sqrt(phi**2 + sigma_new**2)
    phi_new = 1.0 / math.sqrt(1.0 / phi_star**2 + 1.0 / v)
    mu_new = mu + phi_new**2 * delta_sum

    # Step 8: converte de volta para a escala Glicko
    return Rating(
        rating=GLICKO2_SCALE * mu_new + DEFAULT_RATING,
        deviation=GLICKO2_SCALE * phi_new,
        volatility=sigma_new,
    )
