// Short help texts in the style of MATLAB's "help" command.
const H = {
  abs: ['Absolute value.', 'abs(X) is the absolute value of the elements of X. When X is complex, abs(X) is the complex modulus (magnitude) of the elements of X.'],
  sqrt: ['Square root.', 'sqrt(X) is the square root of the elements of X. Complex results are produced if X is not positive.'],
  exp: ['Exponential.', 'exp(X) is the exponential of the elements of X, e to the X.'],
  log: ['Natural logarithm.', 'log(X) is the natural logarithm of the elements of X. Complex results are produced if X is not positive.'],
  log10: ['Common (base 10) logarithm.', 'log10(X) is the base 10 logarithm of the elements of X.'],
  log2: ['Base 2 logarithm.', 'Y = log2(X) is the base 2 logarithm of the elements of X.'],
  sin: ['Sine of argument in radians.', 'sin(X) is the sine of the elements of X.'],
  cos: ['Cosine of argument in radians.', 'cos(X) is the cosine of the elements of X.'],
  tan: ['Tangent of argument in radians.', 'tan(X) is the tangent of the elements of X.'],
  asin: ['Inverse sine, result in radians.', 'asin(X) is the arcsine of the elements of X.'],
  acos: ['Inverse cosine, result in radians.', 'acos(X) is the arccosine of the elements of X.'],
  atan: ['Inverse tangent, result in radians.', 'atan(X) is the arctangent of the elements of X.'],
  sind: ['Sine of argument in degrees.', 'sind(X) is the sine of the elements of X, expressed in degrees.'],
  cosd: ['Cosine of argument in degrees.', 'cosd(X) is the cosine of the elements of X, expressed in degrees.'],
  round: ['Round towards nearest integer.', 'round(X) rounds each element of X to the nearest integer.'],
  floor: ['Round towards minus infinity.', 'floor(X) rounds the elements of X to the nearest integers towards minus infinity.'],
  ceil: ['Round towards plus infinity.', 'ceil(X) rounds the elements of X to the nearest integers towards infinity.'],
  fix: ['Round towards zero.', 'fix(X) rounds the elements of X to the nearest integers towards zero.'],
  rem: ['Remainder after division.', 'rem(x,y) returns x - fix(x./y).*y if y ~= 0.'],
  mod: ['Modulus after division.', 'mod(x,y) returns x - floor(x./y).*y if y ~= 0.'],
  sign: ['Signum function.', 'For each element of X, sign(X) returns 1 if the element is greater than zero, 0 if it equals zero and -1 if it is less than zero.'],
  pow2: ['Base 2 power.', 'pow2(Y) for each element of Y is 2 raised to the power Y.'],
  sum: ['Sum of elements.', 'S = sum(X) is the sum of the elements of the vector X. If X is a matrix, S is a row vector with the sum over each column.\n    S = sum(X,DIM) sums along the dimension DIM.'],
  prod: ['Product of elements.', 'P = prod(X) is the product of the elements of the vector X.'],
  cumsum: ['Cumulative sum of elements.', 'Y = cumsum(X) computes the cumulative sum along the first non-singleton dimension of X.'],
  cumprod: ['Cumulative product of elements.', 'Y = cumprod(X) computes the cumulative product along the first non-singleton dimension of X.'],
  max: ['Largest component.', 'M = max(X) is the largest element in the vector X. For matrices, max(X) is a row vector containing the maximum element from each column.\n    [M,I] = max(X) also returns the indices of the maximum values.\n    max(X,[],DIM) operates along the dimension DIM.\n    C = max(X,Y) returns an array with the largest elements taken from X or Y.'],
  min: ['Smallest component.', 'M = min(X) is the smallest element in the vector X.\n    [M,I] = min(X) also returns the indices of the minimum values.'],
  mean: ['Average or mean value.', 'S = mean(X) is the mean value of the elements in X if X is a vector. For matrices, S is a row vector containing the mean value of each column.\n    mean(X,DIM) takes the mean along the dimension DIM of X.'],
  median: ['Median value.', 'For vectors, median(X) is the median value of the elements in X.'],
  mode: ['Most frequent value.', 'M = mode(X) for vector X computes M as the sample mode, or most frequently occurring value in X.'],
  std: ['Standard deviation.', 'S = std(X) is the standard deviation of the elements of X.\n    std(X,0) normalizes by N-1 (default), std(X,1) normalizes by N.\n    std(X,FLAG,DIM) takes the standard deviation along dimension DIM.'],
  var: ['Variance.', 'Y = var(X) returns the variance of the values in X.'],
  sort: ['Sort in ascending or descending order.', 'B = sort(A) sorts in ascending order.\n    B = sort(A,DIM) sorts along dimension DIM.\n    B = sort(A,DIM,MODE) where MODE is \'ascend\' or \'descend\'.\n    [B,I] = sort(A,...) also returns a sort index I.'],
  length: ['Length of vector.', 'length(X) returns the length of vector X. It is equivalent to max(size(X)) for non-empty arrays and 0 for empty ones.'],
  size: ['Size of array.', 'D = size(X), for M-by-N matrix X, returns the two-element row vector D = [M,N].\n    [M,N] = size(X) returns the number of rows and columns in separate output variables.\n    M = size(X,DIM) returns the length of the dimension specified by DIM.'],
  numel: ['Number of elements in an array.', 'N = numel(A) returns the number of elements N in array A.'],
  zeros: ['Zeros array.', 'zeros(N) is an N-by-N matrix of zeros.\n    zeros(M,N) is an M-by-N matrix of zeros.'],
  ones: ['Ones array.', 'ones(N) is an N-by-N matrix of ones.\n    ones(M,N) is an M-by-N matrix of ones.'],
  eye: ['Identity matrix.', 'eye(N) is the N-by-N identity matrix.\n    eye(M,N) is an M-by-N matrix with 1\'s on the diagonal and zeros elsewhere.'],
  rand: ['Uniformly distributed pseudorandom numbers.', 'R = rand(N) returns an N-by-N matrix containing pseudorandom values drawn from the standard uniform distribution on the open interval(0,1).'],
  randn: ['Normally distributed pseudorandom numbers.', 'R = randn(N) returns an N-by-N matrix containing pseudorandom values drawn from the standard normal distribution.'],
  randi: ['Pseudorandom integers from a uniform discrete distribution.', 'R = randi(IMAX,N) returns an N-by-N matrix containing pseudorandom integer values drawn from the discrete uniform distribution on 1:IMAX.'],
  randperm: ['Random permutation.', 'P = randperm(N) returns a vector containing a random permutation of the integers 1:N.'],
  magic: ['Magic square.', 'magic(N) for positive integer N is an N-by-N matrix constructed from the integers 1 through N^2 with equal row, column, and diagonal sums.'],
  linspace: ['Linearly spaced vector.', 'linspace(X1, X2) generates a row vector of 100 linearly equally spaced points between X1 and X2.\n    linspace(X1, X2, N) generates N points between X1 and X2.'],
  logspace: ['Logarithmically spaced vector.', 'logspace(X1, X2) generates a row vector of 50 logarithmically equally spaced points between decades 10^X1 and 10^X2.'],
  diag: ['Diagonal matrices and diagonals of a matrix.', 'diag(V,K) when V is a vector with N components is a square matrix of order N+ABS(K) with the elements of V on the K-th diagonal.\n    diag(X) is the main diagonal of X.'],
  inv: ['Matrix inverse.', 'inv(X) is the inverse of the square matrix X.'],
  det: ['Determinant.', 'det(X) is the determinant of the square matrix X.'],
  transpose: ['Transpose.', "X.' is the non-conjugate transpose."],
  find: ['Find indices of nonzero elements.', 'I = find(X) returns the linear indices corresponding to the nonzero entries of the array X.\n    [R,C] = find(X) returns the row and column indices.'],
  any: ['True if any element of a vector is a nonzero number.', 'For vectors, any(V) returns logical 1 (TRUE) if any of the elements of the vector is a nonzero number.'],
  all: ['True if all elements of a vector are nonzero.', 'For vectors, all(V) returns logical 1 (TRUE) if none of the elements of the vector are zero.'],
  isempty: ['True for empty array.', 'isempty(X) returns 1 if X is an empty array and 0 otherwise.'],
  disp: ['Display array.', 'disp(X) displays array X without printing the array name or additional description information such as the size and class name.'],
  fprintf: ['Write formatted data to text file.', 'fprintf(FORMAT, A, ...) applies the FORMAT to all elements of array A and any additional array arguments in column order, and writes the data to the screen.'],
  sprintf: ['Write formatted data to string or character vector.', 'STR = sprintf(FORMAT, A, ...) applies FORMAT to all elements of array A and any additional array arguments in column order.'],
  num2str: ['Convert numbers to character array.', 'T = num2str(X) converts the matrix X into a character representation T with about 4 digits and an exponent if required.\n    T = num2str(X,N) converts with N significant digits.'],
  input: ['Prompt for user input.', 'RESULT = input(PROMPT) displays the PROMPT string on the screen, waits for input from the keyboard, evaluates any expressions in the input, and returns the value in RESULT.\n    STR = input(PROMPT,\'s\') returns the entered text as a MATLAB string, without evaluating expressions.'],
  plot: ['Linear plot.', 'plot(X,Y) plots vector Y versus vector X.\n    plot(X,Y,S) where S is a character string made from one element from any or all of the following 3 columns:\n\n           b     blue          .     point              -     solid\n           g     green         o     circle             :     dotted\n           r     red           x     x-mark             -.    dashdot\n           c     cyan          +     plus               --    dashed\n           m     magenta       *     star             (none)  no line\n           y     yellow        s     square\n           k     black         d     diamond\n           w     white         v     triangle (down)\n                               ^     triangle (up)\n                               <     triangle (left)\n                               >     triangle (right)'],
  subplot: ['Create axes in tiled positions.', 'H = subplot(m,n,p), or subplot(mnp), breaks the Figure window into an m-by-n matrix of small axes, selects the p-th axes for the current plot.'],
  xlabel: ['X-axis label.', "xlabel('text') adds text beside the X-axis on the current axis."],
  ylabel: ['Y-axis label.', "ylabel('text') adds text beside the Y-axis on the current axis."],
  title: ['Graph title.', "title('text') adds text at the top of the current axis."],
  legend: ['Display legend.', "legend(string1,string2,string3, ...) puts a legend on the current plot using the specified strings as labels."],
  grid: ['Grid lines.', 'grid ON adds major grid lines to the current axes.\n    grid OFF removes major and minor grid lines from the current axes.'],
  hold: ['Hold current graph.', 'hold ON holds the current plot and all axis properties so that subsequent graphing commands add to the existing graph.\n    hold OFF returns to the default mode.'],
  axis: ['Control axis scaling and appearance.', 'axis([XMIN XMAX YMIN YMAX]) sets scaling for the x- and y-axes on the current plot.\n    axis equal, axis square, axis tight, axis off, axis on.'],
  figure: ['Create figure window.', 'figure, by itself, creates a new figure window.\n    figure(H) makes H the current figure.'],
  polyval: ['Evaluate polynomial.', 'Y = polyval(P,X) returns the value of a polynomial P evaluated at X.'],
  roots: ['Find polynomial roots.', 'roots(C) computes the roots of the polynomial whose coefficients are the elements of the vector C.'],
  conv: ['Convolution and polynomial multiplication.', 'C = conv(A, B) convolves vectors A and B.'],
  deconv: ['Deconvolution and polynomial division.', '[Q,R] = deconv(B,A) deconvolves vector A out of vector B.'],
  polyder: ['Differentiate polynomial.', 'polyder(P) returns the derivative of the polynomial whose coefficients are the elements of vector P.\n    polyder(A,B) returns the derivative of polynomial A*B.\n    [Q,D] = polyder(B,A) returns the derivative of the polynomial ratio B/A.'],
  residue: ['Partial-fraction expansion (residues).', '[R,P,K] = residue(B,A) finds the residues, poles and direct term of a partial fraction expansion of the ratio of two polynomials B(s)/A(s).'],
  syms: ['Create symbolic variables and functions.', 'syms arg1 arg2 ... creates symbolic variables arg1, arg2, ...'],
  diff: ['Difference and approximate derivative / symbolic differentiation.', 'diff(X), for a vector X, is [X(2)-X(1)  X(3)-X(2) ... X(n)-X(n-1)].\n    diff(S) differentiates a symbolic expression S.'],
  int: ['Integrate symbolic expression.', 'int(S) is the indefinite integral of S.\n    int(S,v,a,b) is the definite integral of S with respect to v from a to b.'],
  solve: ['Equations and systems solver.', 'S = solve(eqn,var) solves the equation eqn for the variable var.'],
  dsolve: ['Symbolic solution of ordinary differential equations.', "dsolve('Dy = y^2','y(0)=1') solves the differential equation."],
  simplify: ['Symbolic simplification.', 'simplify(S) performs algebraic simplification of S.'],
  expand: ['Symbolic expansion.', 'expand(S) writes each element of a symbolic expression S as a product of its factors.'],
  factor: ['Prime factors / symbolic factorization.', 'factor(N) returns a vector containing the prime factors of N.\n    factor(S) factors the symbolic expression S.'],
  limit: ['Limit of an expression.', 'limit(F,x,a) takes the limit of the symbolic expression F as x -> a.'],
  strcmp: ['Compare strings.', 'TF = strcmp(S1,S2) compares the strings S1 and S2 and returns logical 1 (true) if they are identical, and returns logical 0 (false) otherwise.'],
  strcat: ['Concatenate text.', 'COMBINEDSTR = strcat(S1, S2, ..., SN) horizontally concatenates text in arrays S1, S2, ..., SN.'],
  findstr: ['Find one string within another.', 'K = findstr(S1,S2) returns the starting indices of any occurrences of the shorter of the two strings in the longer.'],
  strrep: ['Find and replace substring.', 'MODIFIEDSTR = strrep(ORIGSTR, OLDSUBSTR, NEWSUBSTR) replaces all occurrences of OLDSUBSTR within ORIGSTR with NEWSUBSTR.'],
  upper: ['Convert string to uppercase.', 'B = upper(A) converts any lower case characters in A to the corresponding upper case character.'],
  lower: ['Convert string to lowercase.', 'B = lower(A) converts any uppercase characters in A to the corresponding lowercase character.'],
  who: ['List current variables.', 'who lists the variables in the current workspace.'],
  whos: ['List current variables, long form.', 'whos is a long form of who. It lists all the variables in the current workspace, together with information about their size, bytes, class, etc.'],
  clear: ['Clear variables and functions from memory.', 'clear removes all variables from the workspace.\n    clear VARIABLES does the same thing.\n    clear GLOBAL removes all global variables.\n    clear ALL removes all variables, globals, functions and MEX links.'],
  clc: ['Clear command window.', 'clc clears the command window and homes the cursor.'],
  format: ['Set output format.', 'format with no inputs sets the output format to the default appropriate for the class of the variable.\n    format SHORT, format LONG, format SHORT E, format LONG E, format SHORT G, format LONG G, format BANK, format RAT, format COMPACT, format LOOSE.'],
  save: ['Save workspace variables to file.', 'save(FILENAME) stores all variables from the current workspace in a MATLAB formatted binary file (MAT-file) called FILENAME.\n    save(FILENAME,VARIABLES) stores only the specified variables.'],
  load: ['Load data from MAT-file into workspace.', 'S = load(FILENAME) loads the variables from a MAT-file into a structure array, or data from an ASCII file into a double-precision array.\n    load(FILENAME) loads the variables from a MAT-file into the MATLAB workspace.'],
  tic: ['Start a stopwatch timer.', 'tic and toc functions work together to measure elapsed time.'],
  toc: ['Read the stopwatch timer.', 'toc, by itself, displays the elapsed time, in seconds, since the most recent execution of the tic command.'],
  isnan: ['True for Not-a-Number.', 'isnan(X) returns an array that contains 1\'s where the elements of X are NaN\'s and 0\'s where they are not.'],
  isinf: ['True for infinite elements.', 'isinf(X) returns an array that contains 1\'s where the elements of X are +Inf or -Inf and 0\'s where they are not.'],
  error: ['Display message and abort function.', "error(MSG) displays an error message and returns control to the keyboard."],
  for: ['Repeat statements a specific number of times.', 'The general form of a for statement is:\n\n       for variable = expr, statement, ..., statement END'],
  while: ['Repeat statements an indefinite number of times.', 'The general form of a while statement is:\n\n       while expression\n         statements\n       END'],
  if: ['Conditionally execute statements.', 'The general form of the if statement is\n\n       if expression\n         statements\n       ELSEIF expression\n         statements\n       ELSE\n         statements\n       END'],
  switch: ['Switch among several cases based on expression.', 'The general form of the switch statement is:\n\n        switch switch_expr\n          CASE case_expr,\n            statement, ..., statement\n          CASE {case_expr1, case_expr2, case_expr3,...}\n            statement, ..., statement\n         ...\n          OTHERWISE,\n            statement, ..., statement\n        END'],
  meshgrid: ['Cartesian grid in 2-D/3-D space.', '[X,Y] = meshgrid(xgv,ygv) replicates the grid vectors xgv and ygv to produce the coordinates of a rectangular grid (X, Y).'],
  mesh: ['3-D mesh surface.', 'mesh(X,Y,Z) plots the colored parametric mesh defined by four matrix arguments.'],
  surf: ['3-D colored surface.', 'surf(X,Y,Z) creates a 3-D colored surface.'],
  cross: ['Vector cross product.', 'C = cross(A,B) returns the cross product of the vectors A and B.'],
  dot: ['Vector dot product.', 'C = dot(A,B) returns the scalar product of the vectors A and B.'],
  norm: ['Matrix or vector norm.', 'norm(X,2) returns the 2-norm of X.\n    norm(X) is the same as norm(X,2).\n    norm(X,1) returns the 1-norm of X.\n    norm(X,Inf) returns the infinity norm of X.'],
  triu: ['Extract upper triangular part.', 'triu(X) is the upper triangular part of X.\n    triu(X,K) is the elements on and above the K-th diagonal of X.'],
  tril: ['Extract lower triangular part.', 'tril(X) is the lower triangular part of X.\n    tril(X,K) is the elements on and below the K-th diagonal of X.'],
  rot90: ['Rotate array 90 degrees.', 'B = rot90(A) is the 90 degree counterclockwise rotation of matrix A.\n    rot90(A,K) is the K*90 degree rotation of A, K = +-1,+-2,...'],
  repmat: ['Replicate and tile an array.', 'B = repmat(A,M,N) creates a large matrix B consisting of an M-by-N tiling of copies of A.'],
  cat: ['Concatenate arrays.', 'cat(DIM,A,B) concatenates the arrays A and B along the dimension DIM.'],
  xlsread: ['Read Microsoft Excel spreadsheet file.', '[NUM,TXT,RAW]=xlsread(FILE) reads data from the first worksheet in the Microsoft Excel spreadsheet file named FILE.'],
  xlswrite: ['Write Microsoft Excel spreadsheet file.', 'xlswrite(FILE,ARRAY,SHEET,RANGE) writes ARRAY to the Excel file FILE.'],
  readtable: ['Create a table by reading from a file.', 'T = readtable(FILENAME) creates a table by reading from a file.'],
  dblquad: ['Numerically evaluate double integral over a rectangle.', 'Q = dblquad(FUN,XMIN,XMAX,YMIN,YMAX) evaluates the double integral of FUN(X,Y) over the rectangle XMIN <= X <= XMAX, YMIN <= Y <= YMAX.'],
  triplequad: ['Numerically evaluate triple integral.', 'Q = triplequad(FUN,XMIN,XMAX,YMIN,YMAX,ZMIN,ZMAX) evaluates the triple integral of FUN(X,Y,Z) over the three dimensional rectangular region.'],
  fplot: ['Plot function.', 'fplot(FUN,LIMS) plots the function FUN between the x-axis limits specified by LIMS = [XMIN XMAX].'],
  area: ['Filled area plot.', 'area(Y) plots the vector Y or plots each column in matrix Y as a separate curve and stacks the curves.'],
  plot3: ['Plot lines and points in 3-D space.', 'plot3(x,y,z), where x, y and z are three vectors of the same length, plots a line in 3-space through the points whose coordinates are the elements of x, y and z.'],
  semilogx: ['Semi-log scale plot.', 'semilogx(...) is the same as plot(...), except a logarithmic (base 10) scale is used for the X-axis.'],
  semilogy: ['Semi-log scale plot.', 'semilogy(...) is the same as plot(...), except a logarithmic (base 10) scale is used for the Y-axis.'],
  loglog: ['Log-log scale plot.', 'loglog(...) is the same as plot(...), except logarithmic scales are used for both the X- and Y- axes.'],
  plotyy: ['Graphs with y tick labels on the left and right.', 'plotyy(X1,Y1,X2,Y2) plots Y1 versus X1 with y-axis labeling on the left and plots Y2 versus X2 with y-axis labeling on the right.'],
};

const GROUPS = {
  elfun: `  Elementary math functions.

  Trigonometric.
    sin         - Sine.
    sind        - Sine of argument in degrees.
    sinh        - Hyperbolic sine.
    asin        - Inverse sine.
    asind       - Inverse sine, result in degrees.
    asinh       - Inverse hyperbolic sine.
    cos         - Cosine.
    cosd        - Cosine of argument in degrees.
    cosh        - Hyperbolic cosine.
    acos        - Inverse cosine.
    acosd       - Inverse cosine, result in degrees.
    acosh       - Inverse hyperbolic cosine.
    tan         - Tangent.
    tand        - Tangent of argument in degrees.
    tanh        - Hyperbolic tangent.
    atan        - Inverse tangent.
    atand       - Inverse tangent, result in degrees.
    atan2       - Four quadrant inverse tangent.
    atanh       - Inverse hyperbolic tangent.
    sec         - Secant.
    csc         - Cosecant.
    cot         - Cotangent.

  Exponential.
    exp         - Exponential.
    log         - Natural logarithm.
    log10       - Common (base 10) logarithm.
    log2        - Base 2 logarithm and dissect floating point number.
    pow2        - Base 2 power and scale floating point number.
    sqrt        - Square root.
    nthroot     - Real n-th root of real numbers.

  Complex.
    abs         - Absolute value.
    angle       - Phase angle.
    complex     - Construct complex data from real and imaginary parts.
    conj        - Complex conjugate.
    imag        - Complex imaginary part.
    real        - Complex real part.
    isreal      - True for real array.

  Rounding and remainder.
    fix         - Round towards zero.
    floor       - Round towards minus infinity.
    ceil        - Round towards plus infinity.
    round       - Round towards nearest integer.
    mod         - Modulus (signed remainder after division).
    rem         - Remainder after division.
    sign        - Signum.

`,
  ops: `  Operators and special characters.

  Arithmetic operators.
    plus       - Plus                               +
    uplus      - Unary plus                         +
    minus      - Minus                              -
    uminus     - Unary minus                        -
    mtimes     - Matrix multiply                    *
    times      - Array multiply                    .*
    mpower     - Matrix power                       ^
    power      - Array power                       .^
    mldivide   - Backslash or left matrix divide    \\
    mrdivide   - Slash or right matrix divide       /
    ldivide    - Left array divide                 .\\
    rdivide    - Right array divide                ./

  Relational operators.
    eq         - Equal                             ==
    ne         - Not equal                         ~=
    lt         - Less than                          <
    gt         - Greater than                       >
    le         - Less than or equal                <=
    ge         - Greater than or equal             >=

  Logical operators.
    relop      - Short-circuit logical AND         &&
    relop      - Short-circuit logical OR          ||
    and        - Element-wise logical AND           &
    or         - Element-wise logical OR            |
    not        - Logical NOT                        ~
    xor        - Logical EXCLUSIVE OR
    any        - True if any element of vector is nonzero
    all        - True if all elements of vector are nonzero

  Special characters.
    colon      - Colon                              :
    paren      - Parentheses and subscripting      ( )
    paren      - Brackets                          [ ]
    paren      - Braces and subscripting           { }
    punct      - Decimal point                      .
    punct      - Comment                            %
    punct      - Assignment                         =
    transpose  - Transpose                         .'
    ctranspose - Complex conjugate transpose        '

`,
  lang: `  Programming language constructs.

  Control flow.
    if         - Conditionally execute statements.
    else       - Execute statement if previous IF condition failed.
    elseif     - Execute if previous IF failed and condition is true.
    end        - Terminate scope of control statements.
    for        - Repeat statements a specific number of times.
    while      - Repeat statements an indefinite number of times.
    break      - Terminate execution of WHILE or FOR loop.
    continue   - Pass control to the next iteration of a loop.
    switch     - Switch among several cases based on expression.
    case       - SWITCH statement case.
    otherwise  - Default SWITCH statement case.
    try        - Begin TRY block.
    catch      - Begin CATCH block.
    return     - Return to invoking function.
    error      - Display message and abort function.
    assert     - Generate an error when a condition is violated.

  Evaluation and execution.
    eval       - Execute string with MATLAB expression.
    feval      - Execute the specified function.
    input      - Prompt for user input.
    pause      - Wait for user response.

`,
  elmat: `  Elementary matrices and matrix manipulation.

  Elementary matrices.
    zeros       - Zeros array.
    ones        - Ones array.
    eye         - Identity matrix.
    repmat      - Replicate and tile array.
    linspace    - Linearly spaced vector.
    logspace    - Logarithmically spaced vector.
    meshgrid    - X and Y arrays for 3-D plots.
    :           - Regularly spaced vector and index into matrix.

  Basic array information.
    size        - Size of array.
    length      - Length of vector.
    ndims       - Number of dimensions.
    numel       - Number of elements.
    disp        - Display matrix or text.
    isempty     - True for empty array.
    isequal     - True if arrays are numerically equal.

  Matrix manipulation.
    cat         - Concatenate arrays.
    reshape     - Reshape array.
    diag        - Diagonal matrices and diagonals of matrix.
    tril        - Extract lower triangular part.
    triu        - Extract upper triangular part.
    fliplr      - Flip matrix in left/right direction.
    flipud      - Flip matrix in up/down direction.
    rot90       - Rotate matrix 90 degrees.
    find        - Find indices of nonzero elements.
    end         - Last index.
    sort        - Sort in ascending order.

  Special variables and constants.
    ans         - Most recent answer.
    eps         - Floating point relative accuracy.
    realmax     - Largest positive floating point number.
    realmin     - Smallest positive floating point number.
    pi          - 3.1415926535897....
    i           - Imaginary unit.
    inf         - Infinity.
    NaN         - Not-a-Number.

  Specialized matrices.
    magic       - Magic square.

`,
  general: `  General purpose commands.
  MATLAB Version 9.11 (R2021b) — browser edition

  General information.
    syntax       - Help on MATLAB command syntax.
    ver          - MATLAB, Simulink and toolbox version information.
    version      - MATLAB version information.

  Managing the workspace.
    who          - List current variables.
    whos         - List current variables, long form.
    clear        - Clear variables and functions from memory.
    load         - Load workspace variables from disk.
    save         - Save workspace variables to disk.

  Managing commands and functions.
    what         - List MATLAB-specific files in directory.
    type         - List file.
    edit         - Edit file.
    lookfor      - Search all MATLAB files for keyword.
    exist        - Check if variables or functions are defined.

  Controlling the command window.
    clc          - Clear command window.
    home         - Send cursor home.
    format       - Set output format.
    more         - Control paged output in command window.

`,
};

export const HELP = {};
for (const [k, [one, more]] of Object.entries(H)) HELP[k] = { one, more };

export function helpFor(name) {
  if (GROUPS[name]) return GROUPS[name];
  const h = H[name];
  if (!h) return null;
  const [one, more] = h;
  const body = more.split('\n').map(l => '    ' + l.trim()).join('\n');
  return ` ${name} ${one}\n${body}\n\n`;
}
Object.defineProperty(HELP, '__general', { value: GROUPS.general, enumerable: false });
for (const k of Object.keys(H)) HELP[k] = H[k][0] + '\n';
