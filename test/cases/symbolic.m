syms s t
f=s^2+4*s+5
z=exp(-s*t)
findsym(z)
f1=s^3+5*s^2-4;
f2=-2*s^3+s^2+s+1;
f3=f1+f2
f4=f1*f2
f4=expand(f4)
factor(f1)
f2=s^2+6*s+9; factor(f2)
A=-(1/6)/(s+3)-(1/2)/(s+1)+(2/3)/s;
[N,D]=numden(A)
A=(s^3+2*s^2+5*s+10)/(s^2+5); simplify(A)
syms x
finverse(1/tan(x))
finverse(asin(x))
f=s^3-14*s^2+65*s-100;
diff(f)
diff(f,2)
int(f)
syms a b c
solve('a*x^2 + b*x + c')
solve('a*x^2 + b*x + c','b')
p=s^3-2*s^2-3*s+10; solve(p)
syms k real
f=exp(-(k*x)^2); int(f,x,-inf,inf)
f=(1+1/x)^x; limit(f,x,inf)
limit(1/x,x,0,'right')
limit(1/x,x,0,'left')
dsolve('Dy=1+y^2','y(0)=1')
f=x^3-4*x+2
diff(x^4-3*x^2+5)
solve(x^2-5*x+6==0)
simplify(x-2*x^2-4)
dsolve('Dx=2*y','x(0)=1','y')
double(sqrt(sym(2)))
subs(f,x,2)
