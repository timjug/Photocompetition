-- Print everyone's personal link. Replace the base URL with your deployed site.
select name,
       'https://timjug.github.io/Photocompetition/?t=' || token as personal_link
from players
where active
order by name;
