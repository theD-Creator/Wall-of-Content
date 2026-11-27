'use strict';
TeamChat.mount($('#chatRoot'), { onAuth: (ok) => { $('#chatLogin').hidden = ok; $('#chatRoot').hidden = !ok; } });
