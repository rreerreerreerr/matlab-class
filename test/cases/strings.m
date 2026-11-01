s='MATLAB 7 is excellent'; disp(s)
t='In versions of MATLAB prior to 7.5';
disp([s;t])
disp(char(s,t))
P=char(s,t); size(P)
A=eye(3); S=num2str(A)
x=sqrt(2); disp(['x = ',num2str(x)])
disp(['pi = ',num2str(pi,1)])
disp(['pi = ',num2str(pi,4)])
n=18.75; disp(['Your score is: ',num2str(n)])
num2str(pi,20)
x=1:4; y=sqrt(x); fprintf('%9.4f\n',y)
fprintf('y = %9.4f\n',y)
A=[1 2 3;4 5 6;7 8 9]; fprintf('%8.2f %8.2f %8.2f\n',A)
x=3; fprintf('Square root of %g is %8.6f\n',x,sqrt(x));
name='My name is Abbas';
findstr(name,'Abbas')
name(12)
name(12:16)
size(name)
double(name)
char(double(name))
ischar(name)
ischar([1 2 3])
strcmp('abbas','Abbas')
strcmpi('abbas','Abbas')
strncmp('abas','abbas',2)
name=char('Abbas','Hassan','Ali')
name(3,1:3)
s=['my name is Abbas';'he is a teacher']
upper(strcat('Abbas','Hassan','Ali'))
strrep('My name is Abbas','Abbas','Ali')
num2str(pi,20)
x=[2 'Hello' eye(2)]
x={2 'Hello' eye(2)}
x{2}
x(2)
data.color='red'; data.age=12; data.account=[12 2;6 9]
data.account(2,2)
for k=1:5, fact=factorial(k); disp([k fact]), end
%{{
d=3;
switch d
 case {2,4,6,8}
  disp('Even')
 case {1,3,5,7,9}
  disp('Odd')
 otherwise
  disp('Zero')
end
%}}
%{{
for x = 0:pi/15:pi/3
fprintf('%8.2f %8.5f\n',x,sin(x));
end
%}}
