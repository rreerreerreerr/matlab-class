A=[3 7 5;6 8 3;0 4 2];
A(1,3:-1:1)
x=[A(1,:) A(2,:) A(3,:)]
x=[A(1,:)' A(2,:)' A(3,:)']
x=[A(1,1:2) A(3,2:3) A(2,1:2)]
x=[1 2 3;4 5 6;7 8 9];
x(:)'
x(end,end:-1:1)
I=1:3; x(2,I)
exp([1 2;3 4])
log(exp(A(1,:)))
y=abs([-1 2 3;6 -8 -9])
sign([-1.2 3.6 7.8])
x=[2.4 3.5 1.6;-3.3 -4.5 -6.6];
round(x)
fix(x)
floor(x)
ceil(x)
pow2(fix(x))
rem(4,2)
rem(4,2.5)
log10([10 100;1000 20])
sqrt([2 4;9 20])
ones(3,2)
zeros(2,3)
eye(2)
magic(3)
sum(magic(3),1)
sum(diag(magic(3)))
magic(4)
diag(magic(4),1)
diag([1 2 3])
x=[2 -1 3]; y=[-2 3 4];
outer=cross(x,y)
inner=dot(x,y)
theta=acos(dot(x,y)/(norm(x)*norm(y)))
thetad=(180/pi)*theta
nx=norm(x)
z=(dot(x,y)/norm(y)^2)*y
tril(ones(4,4),-1)
rot90([1 2 3;4 5 6;7 8 9])
triu([1 2 3;4 5 6;7 8 9])
inv([2 -3 3;1 -5 3;2 5 7])
det([2 4;6 8])
repmat([1 2;3 4],2,2)
cat(1,[1 2;3 4],[5 6;7 8])
cat(2,[1 2;3 4],[5 6;7 8])
alpha=pi/6; answer=[sin(alpha) cos(alpha) tan(alpha)]
8>2
'2'+2
x={2 'Hello' eye(2)};
x{3}
x{3}(1,2)
single(pi)
double(single(pi))
char(112)
single('MATLAB')
2^53
int64(2^53)
int8(200)
uint8(3.5)
int16(7)/int16(2)
x=1:4; disp(x)
y=3-x; disp([x;y])
disp([x y])
disp([x' y])
